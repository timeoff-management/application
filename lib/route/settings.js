/*
 *
 * */

"use strict";

const
  express   = require('express'),
  router    = express.Router(),
  validator = require('validator'),
  Promise   = require('bluebird'),
  moment    = require('moment'),
  moment_tz = require('moment-timezone'),
  config    = require('../config'),
  Exception = require('../error'),
  {extractUserErrorMessage, extractSystemErrorMessage} = Exception,
  CompanyRemover = require('../model/company/remover'),
  {calculateCarryOverAllowance} = require('../model/calculateCarryOverAllowance'),
  uuidv4    = require('uuid/v4'),
  _         = require('underscore');

const
  CompanyExporter = require('../model/company/exporter');

// Make sure that current user is authorized to deal with settings
router.all(/.*/, require('../middleware/ensure_user_is_admin'));


router.get('/general/', function(req, res){

  res.locals.custom_java_script.push(
    '/js/settings_general.js'
  );

  res.locals.custom_css.push(
    '/css/bootstrap-datepicker3.standalone.css'
  );

  var model = req.app.get('db_model');
  var company;

  req.user.getCompany({
    include : [
      { model : model.LeaveType, as : 'leave_types' },
    ],
    order : [
      [{model: model.LeaveType, as : 'leave_types'}, 'name' ],
    ],
  })
  .then(function(c){
    company = c;
    return company.promise_schedule();
  })
  .then(function(schedule){
    res.render('general_settings', {
      company   : company,
      schedule  : schedule,
      countries : config.get('countries'),
      timezones_available : moment_tz.tz.names(),
      carryOverOptions : getAvailableCarriedOverOptions(),
      yearCurrent: moment.utc().year(),
      yearPrev: moment.utc().add(-1, 'y').year(),
    });
  });
});

router.post('/company/', function(req, res){

  const
    name              = validator.trim(req.body['name']),
    country_code      = validator.trim(req.body['country']),
    date_format       = validator.trim(req.body['date_format']),
    timezone          = validator.trim(req.body['timezone']),
    carriedOverDays   = validator.trim(req.body['carry_over']),
    share_all_absences= validator.toBoolean(
      req.body['share_all_absences']
    ),
    isTeamViewHidden = validator.toBoolean(
      req.body['is_team_view_hidden']
    );

  if (!validator.isAlphanumeric(country_code)){
    req.session.flash_error('Country should contain only letters and numbers');
  }

  if ( ! moment_tz.tz.names().find(tz_str => tz_str === timezone) ) {
    req.session.flash_error('Time zone is unknown');
  }

  if ( ! validator.isNumeric(carriedOverDays)) {
    req.session.flash_error('Carried over allowance has to be a number');
  }

  // In case of validation error redirect back to edit form
  if ( req.session.flash_has_errors() ) {
    return res.redirect_with_session('/settings/general/');
  }

  req.user.getCompany()

  // Validate provided date format
  .then(function(company){

    if ( _.indexOf( company.get_available_date_formats(), date_format ) < 0 ) {
      var error_msg = 'Unknown date format was provided';
      req.session.flash_error(error_msg);
      throw new Error(error_msg);
    }

    return Promise.resolve( company );
  })

  .then(company => {
    company.name              = name;
    company.country           = country_code;
    company.share_all_absences= share_all_absences;
    company.date_format       = date_format;
    company.timezone          = timezone;
    company.carry_over        = carriedOverDays;
    company.is_team_view_hidden = isTeamViewHidden;

    return company.save();
  })
  .then(function(){
      req.session.flash_message('Company was successfully updated');
      return res.redirect_with_session('/settings/general/');
  })
  .catch(function(error){
    console.log(
      `An error occurred when trying to edit company for user ${req.user.id}: ${error} at ${error.stack}`
    );

    req.session.flash_error(
      'Failed to update company details, please contact customer service'
    );

    return res.redirect_with_session('/settings/general/');
  });
});

router.post('/carryOverUnusedAllowance/', (req, res) => {
  req.user
    .getCompany()
    .then(company => company.getUsers())
    .then(users => calculateCarryOverAllowance({users}))
    .then(() => req.session.flash_message(
      'Unused allowance was successfully carried over'
    ))
    .catch(error => {
      const logMarker = uuidv4();
      console.log(
        `[${logMarker}] An error occurred while trying to carry over unused allowance by user ${req.user.id}: ${error} at ${error.stack}`
      );
      req.session.flash_error(
        `Failed to carry over unused allowances, please contact customer service and provide incident ID: ${logMarker}`
      );
    })
    .finally(() => res.redirect_with_session('/settings/general/'));
});

router.post('/schedule/', function(req, res){

  var company, schedule, user,
      model = req.app.get('db_model');

  req.user.getCompany()

    // Obtain scheduler object
    .then(function(c){
      company = c;

      if ( ! req.body.user_id) {
        // We are dealing with company wide schedule: easy
        return company.promise_schedule();
      }

      // Rest is attempt to fetch user specific schedule for given user
      return company.getUsers({
        where : {
          id : validator.trim( req.body.user_id ),
        }
      })
      .then(function(u){
        user = u.pop();

        if ( ! user) {
          throw new Error(
            "Failed to find user "+req.body.user_id+" for company "+company.id
          );
        }

        return user.promise_schedule_I_obey();
      })
      .then(function(sch){
        if (sch.is_user_specific()) {
          // User specific schedule exists in database
          return Promise.resolve(sch);
        }

        // No user specific schedule in database: create in memory default instance
        return model.Schedule
          .promise_to_build_default_for({ user_id : user.id });
      });
    })

    // Update schedule object
    .then(function(sch){
      schedule = sch;

      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        .forEach(function(day){ schedule.set(day, req.body[day]) });

      if (schedule.is_user_specific() && _.has(req.body, 'revoke_user_specific_schedule') ) {
        return schedule.destroy();
      } else {
        return schedule.save();
      }
    })

    // Action is successfully done
    .then(function(){
      req.session.flash_message( schedule.is_user_specific()
        ? 'Schedule for user was saved'
        : 'Schedule for company was saved'
      );
    })

    // Action failed
    .catch(function(error){
      console.error('An error occurred while saving schedule: ' + error);
      req.session.flash_error( schedule.is_user_specific()
        ? 'Failed to save user schedule'
        : 'Failed to save company schedule'
      );

    })

    // Depending on context redirect user to particular page
    .finally(function(){
      res.redirect_with_session(schedule.is_user_specific()
        ? (user ? '/users/edit/'+user.id+'/schedule/' : '/users/')
        : '/settings/general/'
      );
    });
});

router.post('/leavetypes', function(req, res){

  var model = req.app.get('db_model');

  req.user

    .get_company_with_all_leave_types()
    .then(function(company){

      var promise_new_leave_type = Promise.resolve(1);

      if (validator.trim(req.body['name__new'])) {
        var attributes = get_and_validate_leave_type({
          req       : req,
          suffix    : 'new',
          item_name : 'New Leave Type'
        });
        attributes.companyId = company.id;
        promise_new_leave_type = model.LeaveType.create(attributes);
      }

      return Promise.all([
        promise_new_leave_type,
        _.map(
          company.leave_types,
          function(leave_type){

            let attributes = get_and_validate_leave_type({
              req       : req,
              suffix    : leave_type.id,
              item_name : leave_type.name,
            });

            // Update leave type only if there are attributes submitted for it
            return attributes
              ? leave_type.updateAttributes(attributes)
              : Promise.resolve(1);
          }

        ) // End of map that create leave type update promises
      ]);
    })
    .then(() => {
      req.session.flash_message('Changes to leave types were saved');
      return res.redirect_with_session('/settings/general/');
    })
    .catch(error => {
      console.error(
        'An error occurred when trying to edit Leave types by user '+req.user.id
        + ' : ' + error
      );

      if (error.hasOwnProperty('user_message')) {
        req.session.flash_error( error.user_message );
      }

      req.session.flash_error(
        'Failed to update leave types details, please contact customer service'
      );

      return res.redirect_with_session('/settings/general/');
    });
});

router.post('/leavetypes/delete/:leave_type_id/', function(req, res){

    var leave_type_id = req.params['leave_type_id'];

    var model = req.app.get('db_model');

    if (!validator.isInt(leave_type_id)) {
        console.log(`User ${req.user.id} submitted non-int leave_type id [${leave_type_id}]`);

        req.session.flash_error('Cannot remove leave_type: wrong parameters');

        return res.redirect_with_session('/settings/general/');
    }

    req.user.getCompany({
        include : [{
            model : model.LeaveType,
            as : 'leave_types',
            include : [{model: model.Leave, as: 'leaves'}],
        }],
        order : [[{model: model.LeaveType, as : 'leave_types'}, 'name' ]],
    })
    .then(function(company){
        var leave_type_to_remove = company.leave_types.find( lt => String(lt.id) === String(leave_type_id) );

        // Check if user specify valid department number
        if (! leave_type_to_remove) {

            req.session.flash_error('Cannot remove leave type: wronge parameters');

            throw new Error(
              'User '+req.user.id+' tried to remove non-existing leave type number'
              +leave_type_id+' out of '+company.leave_types.length
            );


        // Check if there exist leaves for current type and if so, do not remove it
        } else if (leave_type_to_remove.leaves.length > 0) {

            req.session.flash_error('Cannot remove leave type: type is in use');

            throw new Error('Failed to remove Leave type because it is in used.');
        }

        return leave_type_to_remove.destroy();
    })
    .then(function(){
        req.session.flash_message('Leave type was successfully removed');
        return res.redirect_with_session('/settings/general/');
    })
    .catch(function(error){
        console.error(
            'An error occurred when trying to remove leave type by user' + req.user.id
            + ' : ' + error
        );

        req.session.flash_error(
          'Failed to remove Leave Type'
        );

        return res.redirect_with_session('/settings/general/');
    });
});

router.get('/company/integration-api/', (req, res) => {
  req.user
    .getCompany()
    .then(company => res.render('settings_company_integration_api', {
      company,
    }));
});

router.post('/company/integration-api/', (req, res) => {
  const featureIsEnabled = validator.toBoolean(req.body.integration_api_enabled);

  let action = req.user.getCompany();

  action = action.then(company => {
    company.set('integration_api_enabled', featureIsEnabled);
    return company.save();
  });

  if (req.body.regenerate_token) {
    action = action.then( company => company.regenerateIntegrationApiToken() );
  }

  action = action.then(() => {
    req.session.flash_message('Settings were saved');

    return res.redirect_with_session('./');
  });

  action = action.catch(error => {
    console.log(`Failed to save Integration API configuration, reason: ${ extractSystemErrorMessage(error) }`);

    req.session.flash_error(
      `Failed to save settings. ${ extractUserErrorMessage(error) }`
    );

    return res.redirect_with_session('./');
  })
});

router.get('/company/authentication/', function(req, res){

  req.user
    .getCompany()
    .then(function(company){
      res.render('settings_company_authentication', {
        company     : company,
        ldap_config : company.get('ldap_auth_config'),
      });
    });
});

router.post('/company/authentication/', function(req, res){

  req.user
    .getCompany()
    .then(function(company){

      var parameters = get_and_validate_ldap_auth_configuration({
        req : req,
      });

      // Updaye in memory Company object but do not save changes until new LDAP
      // configuration checked against current user
      // (this is needed to prevent situation when admin by lock herself out)
      company.set('ldap_auth_config', parameters.ldap_config);
      company.setDataValue('ldap_auth_enabled', parameters.ldap_auth_enabled);

      var ldap_server = company.get_ldap_server();

      // Handle event based errors from ldapauth-fork
      var ldapError = "";
      ldap_server.on('error', function(err) {
        ldapError = err;
      });

      var auth_func = function(email, password) {
        return new Promise(function(resolve, reject) {
          // Wait one second before cheking for event based errors
          setTimeout(() => {
            if (ldapError) {
              reject(ldapError);
            }
          }, 1000);

          ldap_server.authenticate(email, password, function(error, user) {
            if (error) {
              reject(error);
            } else {
              resolve(user);
            }
          });
      });
    };

    return auth_func(req.user.email, parameters.password_to_check)
      .then(function(){
        return company.save();
      })
      .catch(function(error){
        error = new Error(
          "Failed to validate new LDAP settings with provided current user password. "+error
        );
        error.show_to_user = true;
        throw error;
      });
    })

    .then(function(){
      if ( req.session.flash_has_errors() ) {
        return res.redirect_with_session('/settings/company/authentication/');
      } else {
        req.session.flash_message('LDAP configuration was updated');
        return res.redirect_with_session('/settings/company/authentication/');
      }
    })
    .catch(function(error){
      console.error(
        "An error occured while trying to update LDAP configuration: %s", error
      );

      req.session.flash_error(
        'Failed to update LDAP configuration. ' +
        ( error.show_to_user ? error : 'Please contact customer service')
      );

      return res.redirect_with_session('/settings/company/authentication/');
    });
});

function get_and_validate_leave_type(args) {
  let
    req       = args.req,
    suffix    = args.suffix,
    item_name = args.item_name;

  // Get user parameters
  let
    name          = validator.trim(req.body['name__'+suffix]),
    color        = validator.trim(req.body['color__'+suffix]) || 'leave_type_color_1',
    limit        = validator.trim(req.body['limit__'+suffix]) || 0,
    first_record = validator.trim(req.body['first_record'])   || 0,
    use_allowance = validator.toBoolean(
      req.body['use_allowance__'+suffix]
    ),
    auto_approve = validator.toBoolean(
      req.body['auto_approve__'+suffix]
    );

  // If no name for leave type was provided: do nothing - treat case
  // as no need to update the leave type
  if ( ! name ) {
    return false;
  }

  // VPP TODO move that into resusable component
  let throw_user_error = function(message){
    let error = new Error(message);
    error.user_message = message;
    throw error;
  };

  // Validate provided parameters
  if ( ! validator.matches(color, /^leave_type_color_\d+$/)) {
    throw_user_error( 'New color for '+item_name+' should be valid css class' );
  }

  if ( ! validator.isNumeric(limit) ){
    throw_user_error( 'New limit for '+item_name+' should be a valide number' );

  } else if ( limit < 0) {
    throw_user_error( 'New limit for '+item_name+' should be positive number or 0' );
  }

  return {
    name          : name,
    color         : color,
    use_allowance : use_allowance,
    auto_approve  : auto_approve,
    limit         : limit,
    sort_order    : ( (first_record && (String(first_record)===String(suffix))? 1 : 0) ),
  };
}

function get_and_validate_ldap_auth_configuration(args) {
  var req = args.req;

  // Get parameters
  //
  var url                      = validator.trim(req.body['url']),
  binddn                       = validator.trim(req.body['binddn']),
  bindcredentials              = validator.trim(req.body['bindcredentials']),
  searchbase                   = validator.trim(req.body['searchbase']),
  ldap_auth_enabled            = validator.toBoolean(req.body['ldap_auth_enabled']),
  allow_unauthorized_cert      = validator.toBoolean(req.body['allow_unauthorized_cert']),

  // Fetch the password of current user that is valid in LDAP system
  password_to_check = validator.trim(req.body['password_to_check']);

  // Validate provided parameters

  if (!validator.matches(url, /^ldaps?:\/\/[a-z0-9\.\-]+:\d+$/i)){
    req.session.flash_error(
      "URL to LDAP server must be of following format: 'ldap://HOSTNAME:PORT'"
    );
  }

  if ( req.session.flash_has_errors() ) {
    var error = new Error("Validation failed");
    error.show_to_user = true;
    throw error;
  }

  // Return the configuration object
  return {
    ldap_config : {
      url                     : url,
      binddn                  : binddn,
      bindcredentials         : bindcredentials,
      searchbase              : searchbase,
      allow_unauthorized_cert : allow_unauthorized_cert,
    },
    ldap_auth_enabled : ldap_auth_enabled,
    password_to_check : password_to_check,
  };
}

router.get('/company/backup/', (req, res) => {
  const companyExporter = new CompanyExporter({
    dbSchema : req.app.get('db_model'),
  });

  let company;

  req.user
    .getCompany()
    .then(c => Promise.resolve(company = c))

    // Generate company summary
    .then(company => companyExporter.promiseCompanySummary({ company : company }))

    // Get CSV presentation of company summary
    .then(companySummary => companySummary.promise_as_csv_string())

    .then(csv_content => {

      res.attachment(
        company.name_for_machine()+'_backup.csv'
      );

      res.send(csv_content);
    })
    .catch(function(error){
      console.error(
        "An error occured while downloading company summary: %s, at %s", error, error.stack
      );

      req.session.flash_error(
        "Failed to download company summary. " +
        ( error.show_to_user ? error : 'Please contact customer service')
      );

      return res.redirect_with_session('/settings/general/');
    });
});

router.post('/company/delete/', (req, res) => {

  let company;

  req.user
    .getCompany()
    .then(c => Promise.resolve(company = c))
    .then(company => CompanyRemover.promiseToRemove({
      company     : company,
      byUser      : req.user,
      confirmName : req.body.confirm_name,
    }))
    .then(() => {
      req.session.flash_message(`Company ${company.name} and related data were successfully removed`);

      return res.redirect_with_session('/');
    })
    .catch(error => {

      console.log(
        `Failed to remove ${company.id} by user ${req.user.id}. Reason: ${ Exception.extract_system_error_message(error) }, at ${error.stack}`
      );

      req.session.flash_error(
        `Failed to remove company. Reason: ${ Exception.extract_user_error_message(error) }`
      );

      return res.redirect_with_session('/settings/general/');
    });
});

const getAvailableCarriedOverOptions = () => ([
  {days : 0, label : 'None'},
  ...[...Array(21).keys()].filter(i=>i>0).map(i=>({days:i, label:i})),
  {days: 1000, label: 'All'},
]);

module.exports = router;
