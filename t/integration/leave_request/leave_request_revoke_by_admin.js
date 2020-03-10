
'use strict';

var test             = require('selenium-webdriver/testing'),
    By               = require('selenium-webdriver').By,
    expect           = require('chai').expect,
    _                = require('underscore'),
    Promise          = require("bluebird"),
    moment           = require('moment'),
    until            = require('selenium-webdriver').until,
    login_user_func        = require('../../lib/login_with_user'),
    register_new_user_func = require('../../lib/register_new_user'),
    logout_user_func       = require('../../lib/logout_user'),
    open_page_func         = require('../../lib/open_page'),
    submit_form_func       = require('../../lib/submit_form'),
    check_elements_func    = require('../../lib/check_elements'),
    check_booking_func     = require('../../lib/check_booking_on_calendar'),
    add_new_user_func      = require('../../lib/add_new_user'),
    config                 = require('../../lib/config'),
    application_host       = config.get_application_host(),
    currentYear = moment.utc().year(),
    monday = moment().year(currentYear).month('May').day(15).startOf('isoWeek'),
    tuesday = moment(monday).add(1, 'd');

/*
 *  Scenario to check:
 *    * Add EMPLOYEE
 *    * Login as a EMPLOYEE
 *    * Book a leave request
 *    * Login as MANAGER and approve leave request
 *    * Revoke recently added leave request
 *    * Approve revoke request and make sure that EMPLOYEE
 *    does not have leave any more
 *
 * */

describe('Revoke leave request by Admin', function(){

  this.timeout( config.get_execution_timeout() );

  let email_admin,
      email_employee, employee_user_id,
      driver;

  it("Create new company", function(done){
    register_new_user_func({
      application_host : application_host,
    })
    .then(function(data){
      email_admin = data.email;
      driver = data.driver;
      done();
    });
  });

  it("Create EMPLOYEE-to-be user", function(done){
    add_new_user_func({
      application_host : application_host,
      driver           : driver,
    })
    .then(function(data){
      email_employee = data.new_user_email;
      done();
    });
  });

  it("Logout from admin account", function(done){
    logout_user_func({
      application_host : application_host,
      driver           : driver,
    })
    .then(function(){ done() });
  });

  it("Login as EMPLOYEE user", function(done){
    login_user_func({
      application_host : application_host,
      user_email       : email_employee,
      driver           : driver,
    })
    .then(function(){ done() });
  });

  it("Open calendar page", function(done){
    open_page_func({
      url    : application_host + `calendar/?year=${currentYear}&show_full_year=1`,
      driver : driver,
    })
    .then(function(){ done() });
  });

  it("And make sure that it is calendar indeed", function(done){
    driver.getTitle()
      .then(function(title){
        expect(title).to.be.equal('Calendar');
        done();
      });
  });

  it("Create new leave request", function(done){
    driver.findElement(By.css('#book_time_off_btn'))
      .then(function(el){ return el.click() })

      // Create new leave request
      .then(function(){

        // This is very important line when working with Bootstrap modals!
        driver.sleep(1000);

        submit_form_func({
          driver      : driver,
          // The order matters here as we need to populate dropdown prior date filds
          form_params : [{
            selector        : 'select[name="from_date_part"]',
            option_selector : 'option[value="2"]',
            value           : "2",
          },{
            selector : 'input#from',
            value : monday.format('YYYY-MM-DD'),
          },{
            selector : 'input#to',
            value : tuesday.format('YYYY-MM-DD'),
          }],
          message : /New leave request was added/,
        })
        .then(function(){ done() });
      });
  });

  it("Check that all days are marked as pended", function(done){
    check_booking_func({
      driver         : driver,
      full_days      : [tuesday],
      halfs_1st_days : [monday],
      type           : 'pended',
    })
    .then(function(){ done() });
  });

  it("Logout from EMPLOYEE account", function(done){
    logout_user_func({
      application_host : application_host,
      driver           : driver,
    })
    .then(function(){ done() });
  });

  it("Login as an ADMIN user", function(done){
    login_user_func({
      application_host : application_host,
      user_email       : email_admin,
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

  it('Make sure that newly created request is waiting for approval', function(done){
    check_elements_func({
      driver : driver,
      elements_to_check : [{
        selector : 'tr[vpp="pending_for__'+email_employee+'"] .btn-warning',
        value    : "Reject",
      }],
    })
    .then(function(){ done() });
  });

  it("Approve newly added leave request", function(done){
    driver
      .findElement(By.css(
        'tr[vpp="pending_for__'+email_employee+'"] .btn-success'
      ))
      .then(function(el){ return el.click(); })
      .then(function(){
        // Wait until page properly is reloaded
        return driver.wait(until.elementLocated(By.css('h1')), 1000);
      })
      .then(function(){ done() });
  });

  it("Open department settings page", function(done){
      open_page_func({
        url    : application_host + 'settings/departments/',
        driver : driver,
      })
      .then(function(){ done() });
  });

  it("Obtain employee ID from department managment page", function(done){
    driver.findElement(
        By.css('select[name="boss_id__new"] option:nth-child(2)')
      )
      .then(function(el){ return el.getAttribute('value') })
      .then(function(value){
        employee_user_id = value;
        expect( employee_user_id ).to.match(/^\d+$/);
        done();
      });
  });

  it("Open user editing page for Employee", function(done){
    open_page_func({
      url    : application_host + 'users/edit/'+employee_user_id+'/absences/',
      driver : driver,
    })
    .then(function(){ done() });
  });

  it("... and revoke her time off", function(done){
    driver
      .findElement(By.css(
        'button.revoke-btn'
      ))
      .then(function(el){ return el.click(); })
      .then(function(){
        // Wait until page properly is reloaded
        return driver.wait(until.elementLocated(By.css('h1')), 1000);
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

  it("Make sure newly revoked request is shown for approval", function(done){
    check_elements_func({
      driver : driver,
      elements_to_check : [{
        selector : 'tr[vpp="pending_for__'+email_employee+'"] .btn-warning',
        value    : "Reject",
      }],
    })
    .then(function(){ done() });
  });

  it("Approve revoke request", function(done){
    driver
      .findElement(By.css(
        'tr[vpp="pending_for__'+email_employee+'"] .btn-success'
      ))
      .then(function(el){ return el.click(); })
      .then(function(){
        // Wait until page properly is reloaded
        return driver.wait(until.elementLocated(By.css('h1')), 1000);
      })
      .then(function(){ done() });
  });

  after(function(done){
    driver.quit().then(function(){ done(); });
  });
});
