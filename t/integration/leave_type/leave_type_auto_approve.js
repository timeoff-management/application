
'use strict';

var test                 = require('selenium-webdriver/testing'),
  By                     = require('selenium-webdriver').By,
  until                  = require('selenium-webdriver').until,
  Promise                = require("bluebird"),
  expect                 = require('chai').expect,
  add_new_user_func      = require('../../lib/add_new_user'),
  config                 = require('../../lib/config'),
  login_user_func        = require('../../lib/login_with_user'),
  logout_user_func       = require('../../lib/logout_user'),
  open_page_func         = require('../../lib/open_page'),
  register_new_user_func = require('../../lib/register_new_user'),
  submit_form_func       = require('../../lib/submit_form'),
  user_info_func         = require('../../lib/user_info'),
  application_host       = config.get_application_host(),
  some_weekday_date      = '2015-06-17',
  leave_type_new_form_id ='#leave_type_new_form';

/*
 *  Scenario:
 *    * Create new company with admin user A and regular employee B
 *    * Create leave type that requires no approval
 *    * Login as user B and place a leave request
 *    * Ensure that it went straight to Approved status
 *    * Login as user A and ensure there is no leave request pended
 *    * Go to email audit page and ensure that last two emails are related
 *      to auto approved leave requests
 *    * Login as user B
 *    * Revoke recently added leave
 *    * Ensure that it is gone without need to be approved, no leaves are listed
 *      for user B
 *    * Login back as user A and ensure that user B does not have any leaves
 *    * There is no leave request to be processed
 *    * Go to email audit page and ensure that the last two emails are about
 *      auto approving of leave revoke
 *
 * */

describe('Auto approval leave type', function(){

  this.timeout( config.get_execution_timeout() );

  var driver, email_A, email_B, user_id_B;

  it("Register new company", function(done){
    register_new_user_func({
      application_host : application_host,
    })
    .then(function(data){
      driver  = data.driver;
      email_A = data.email;
      done();
    });
  });

  it("Create second user B", function(done){
    add_new_user_func({
      application_host : application_host,
      driver           : driver,
    })
    .then(function(data){
      email_B = data.new_user_email;
      done();
    });
  });

  it("Obtain information about user B", function(done){
    user_info_func({
      driver : driver,
      email  : email_B,
    })
    .then(function(data){
      user_id_B = data.user.id;
      done();
    });
  });

  it("Open page with leave types", function(done){
    open_page_func({
      url    : application_host + 'settings/general/',
      driver,
    })
    .then(() => done());
  });

  it("Add auto approve leave type", function(done){
    driver.findElement(By.css('#add_new_leave_type_btn'))
      .then(function(el){
        return el.click();
      })
      .then(function(){

        // This is very important line when working with Bootstrap modals!
        driver.sleep(1000);

        submit_form_func({
          driver      : driver,
          form_params : [{
              selector : leave_type_new_form_id+' input[name="name__new"]',
              value : 'AAAAA',
          },{
              selector : leave_type_new_form_id+' input[name="auto_approve__new"]',
              value    : 'on',
              tick     : true,
          }],
          submit_button_selector : leave_type_new_form_id+' button[type="submit"]',
          message : /Changes to leave types were saved/,
        })
        .then(function(){ done() });
      });
  });

  it("Logout from admin user", function(done){
    logout_user_func({
      application_host : application_host,
      driver           : driver,
    })
    .then(function(){ done() });
  });

  it("Login as regular user B", function(done){
    login_user_func({
      application_host : application_host,
      user_email       : email_B,
      driver           : driver,
    })
    .then(function(){ done() });
  });

  it("Open Book leave popup window", function(done){
    driver.findElement(By.css('#book_time_off_btn'))
      .then(function(el){ return el.click() })
      .then(function(el){
        // This is very important line when working with Bootstrap modals!
        return driver.sleep(1000);
      })
      .then(function(){ done() });
  });

  it("Submit new leave request from non admin user", function(done){
    submit_form_func({
      driver      : driver,
      form_params : [{
        selector : 'input#from',
        value    : some_weekday_date,
      },{
        selector : 'input#to',
        value    : some_weekday_date,
      }],
      message : /New leave request was added/,
    })
    .then(function(){done()});
  });

  it("Open requests page", function( done ){
    open_page_func({
      url    : application_host + 'requests/',
      driver : driver,
    })
    .then(function(){ done() });
  });

  it("Ensure that new leave went straight to Approved status", function(done){
    driver
      .findElements(By.css( 'tr.leave-request-row .leave-request-row-status' ))
      .then(function(elements){
        expect(elements.length).to.be.eq(1);
        return elements[0].getText();
      })
      .then(function(status){
        expect( status ).to.be.eq('Approved');
        done();
      });
  });

  it("Logout from user B", function(done){
    logout_user_func({
      application_host : application_host,
      driver           : driver,
    })
    .then(function(){ done() });
  });

  it("Login as admin user A", function(done){
    login_user_func({
      application_host : application_host,
      user_email       : email_A,
      driver           : driver,
    })
    .then(function(){ done() });
  });

  it("Open requests page", function( done ){
    open_page_func({
      url    : application_host + 'requests/',
      driver : driver,
    })
    .then(function(){ done() });
  });

  it('Ensure that there is no pending leave requests', function(done){
    driver
      .findElements(By.css( '.btn-warning' ))
      .then(function(elements){
        expect( elements.length ).to.be.eq(0);
        done();
      })
  });

  it("Open email audit page", function( done ){
    open_page_func({
      url    : application_host + 'audit/email/',
      driver : driver,
    })
    .then(function(){ done() });
  });

  it('Ensure there were two emails regarding auto-approved leaves', function(done){
    driver
      .findElements( By.css('tr.vpp-email-audit-entry-header a.collapsed') )
      .then(function(elements){
        return Promise.map(
          [elements[0], elements[1]],
          function(el){ return el.getText() }
        );
      })
      .then(function(subjects){
        expect(subjects).to.contain('New leave was added and auto approved.');
        expect(subjects).to.contain('New leave was added');
        done();
      })
  });

  it("Logout from admin user", function(done){
    logout_user_func({
      application_host : application_host,
      driver           : driver,
    })
    .then(function(){ done() });
  });

  it("Login as regular user B", function(done){
    login_user_func({
      application_host : application_host,
      user_email       : email_B,
      driver           : driver,
    })
    .then(function(){ done() });
  });

  it("Open requests page", function(done){
    open_page_func({
      url    : application_host + 'requests/',
      driver : driver,
    })
    .then(function(){ done() });
  });

  it('Revoke request', function(done){
    driver
      .findElement(By.css(
        'button.revoke-btn'
      ))
      .then(function(el){ return el.click(); })
      .then(function(){
        // Wait until page properly is reloaded
        return driver.wait(until.elementLocated(By.css('h1')), 1000);
      })
      .then(function(){
        return driver.findElement( By.css('.alert-success')  )
          .then(function(el){
            expect(el).to.be.ok;
            return Promise.resolve(1);
          })
      })
      .then(function(){ done() });
  });

  it("Ensure that it is gone without need to be approved", function(done){
    driver
      .findElements(By.css( 'tr.leave-request-row .leave-request-row-status' ))
      .then(function(elements){
        expect(elements.length).to.be.eq(0);
        done();
      });
  });

  it("Logout from user B", function(done){
    logout_user_func({
      application_host : application_host,
      driver           : driver,
    })
    .then(function(){ done() });
  });

  it("Login as admin user A", function(done){
    login_user_func({
      application_host : application_host,
      user_email       : email_A,
      driver           : driver,
    })
    .then(function(){ done() });
  });

  it('Open user B absences section', function(done){
    open_page_func({
      url    : application_host + 'users/edit/'+user_id_B+'/absences/',
      driver : driver,
    })
    .then(function(){ done() });
  });

  it("Ensure that user B does not have any leaves", function(done){
    driver
      .findElements(By.css( 'tr.leave-request-row .leave-request-row-status' ))
      .then(function(elements){
        expect(elements.length).to.be.eq(0);
        done();
      });
  });

  it("Open requests page", function( done ){
    open_page_func({
      url    : application_host + 'requests/',
      driver : driver,
    })
    .then(function(){ done() });
  });

  it('Ensure that there is no pending leave requests', function(done){
    driver
      .findElements(By.css( '.btn-warning' ))
      .then(function(elements){
        expect( elements.length ).to.be.eq(0);
        done();
      })
  });

  it("Open email audit page", function( done ){
    open_page_func({
      url    : application_host + 'audit/email/',
      driver : driver,
    })
    .then(function(){ done() });
  });

  it('Ensure there were two emails regarding auto-approved leaves', function(done){
    driver
      .findElements( By.css('tr.vpp-email-audit-entry-header a.collapsed') )
      .then(function(elements){
        return Promise.map(
          [elements[0], elements[1]],
          function(el){ return el.getText() }
        );
      })
      .then(function(subjects){
        expect(subjects).to.contain('Leave was revoked and auto approved');
        expect(subjects).to.contain('Leave was revoked');
        done();
      })
  });

  after(function(done){
    driver.quit().then(function(){ done(); });
  });

});
