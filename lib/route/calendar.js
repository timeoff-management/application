
"use strict";

var express   = require('express'),
    router    = express.Router(),
    Promise   = require('bluebird'),
    moment    = require('moment'),
    _         = require('underscore'),
    validator = require('validator'),
    get_and_validate_leave_params = require('./validator/leave_request'),
    TeamView                      = require('../model/team_view'),
    EmailTransport                = require('../email');

const {createNewLeave, getLeaveForUserView, doesUserHasExtendedViewOfLeave} = require('../model/leave');
const { leaveIntoObject } = require('../model/Report');
const { getCommentsForLeave } = require('../model/comment');

router.post('/bookleave/', function(req, res){

  let companyHold;
    Promise.join (
      req.user.promise_users_I_can_manage(),
      req.user.get_company_with_all_leave_types(),
      Promise.try( () => get_and_validate_leave_params({req})),
      (users, company, valide_attributes) => {
companyHold = company;
        // Make sure that indexes submitted map to existing objects
        var employee = users[valide_attributes.user] || req.user,
          leave_type = company.leave_types[valide_attributes.leave_type];

        if (!employee) {
          req.session.flash_error('Incorrect employee');
          throw new Error( 'Got validation errors' );
        }

        if (!leave_type) {
          req.session.flash_error('Incorrect leave type');
          throw new Error( 'Got validation errors' );
        }

        if (company.is_mode_readonly_holidays() ){
          req.session.flash_error(
            "Company account is locked and new Timeoff "
            + "requests could not be added. Please contact administration."
          );
          throw new Error('Company is in "Read-only holidays" mode');
        }

        return createNewLeave({
          holiday_year_start_month : company.holiday_year_start_month,
          for_employee    : employee,
          of_type         : leave_type,
          with_parameters : valide_attributes,
        });
      }
    )
    .then(leave => leave.reloadWithAssociates())
    .then(leave => (new EmailTransport()).promise_leave_request_emails({leave,holiday_year_start_month :companyHold.holiday_year_start_month}))
    .then(function(){

        req.session.flash_message('New leave request was added');
        return res.redirect_with_session(
          req.body['redirect_back_to']
            ? req.body['redirect_back_to']
            : '../'
        );
    })

    .catch(function(error){
        console.error(
            'An error occured when user '+req.user.id+
            ' try to create a leave request: '+error+
            ' at: ' + error.stack
        );
        req.session.flash_error('Failed to create a leave request');
        if (error.hasOwnProperty('user_message')) {
            req.session.flash_error(error.user_message);
        }
        return res.redirect_with_session(
          req.body['redirect_back_to']
            ? req.body['redirect_back_to']
            : '../'
        );
    });

});

router.get('/', function(req, res) {

  var current_year = validator.isNumeric(req.query['year'])
    ? moment.utc(req.query['year'], 'YYYY')
    : req.user.company.get_today();

  var show_full_year = validator.toBoolean(req.query['show_full_year']);

  Promise.join(
    req.user.promise_calendar({
      year           : current_year.clone(),
     holiday_year_start_month :req.user.company.holiday_year_start_month,
      show_full_year : show_full_year,
    }),
    req.user.get_company_with_all_leave_types(),
    req.user.reload_with_leave_details({holiday_year_start_month :req.user.company.holiday_year_start_month, year : current_year }),
    req.user.promise_supervisors(),
    req.user.promise_allowance({ year : current_year, holiday_year_start_month :req.user.company.holiday_year_start_month }),
    function(calendar, company, user, supervisors, user_allowance){
      let
        full_leave_type_statistics = user.get_leave_statistics_by_types();

      res.render('calendar', {
        calendar : _.map(calendar, function(c){return c.as_for_template()}),
        company        : company,
        title          : 'Calendar',
        current_user   : user,
        supervisors    : supervisors,
        previous_year  : moment.utc(current_year).add(-1,'year').format('YYYY'),
        current_year   : current_year.format('YYYY'),
        next_year      : moment.utc(current_year).add(1,'year').format('YYYY'),
        show_full_year : show_full_year,
        leave_type_statistics      : _.filter(full_leave_type_statistics, st => st.days_taken > 0),

        // User allowance object is simple object with attributes only
        user_allowance : user_allowance,
      });
    }
  );

});

router.get('/teamview/', function(req, res){

  if (req.user.company.is_team_view_hidden && ! req.user.admin) {
    return res.redirect_with_session('/');
  }

  const base_date = validator.isDate(req.query['date'])
    ? moment.utc(req.query['date'])
    : req.user.company.get_today();

  const team_view = new TeamView({
    base_date : base_date,
    user      : req.user,
  });

  const current_deparment_id  = validator.isNumeric(req.query['department'])
    ? req.query['department']
    : null;

  Promise.join(
    team_view.promise_team_view_details({
      department_id : current_deparment_id,
    }),
    req.user.get_company_with_all_leave_types(),
    (team_view_details, company) => {
      // Enrich "team view details" with statistics as how many deducted days each employee spent current month
      team_view
        .inject_statistics({
          team_view_details : team_view_details,
          leave_types       : company.leave_types,
        })
        .then( team_view_details => team_view.restrainStatisticsForUser({
          team_view_details : team_view_details,
          user              : req.user,
        }))
        .then(team_view_details => res.render('team_view', {
            base_date           : base_date,
            prev_date           : moment.utc(base_date).add(-1,'month'),
            next_date           : moment.utc(base_date).add(1,'month'),
            users_and_leaves    : team_view_details.users_and_leaves,
            related_departments : team_view_details.related_departments,
            current_department  : team_view_details.current_department,
            company             : company,
          })
        );
    })
    .catch(error => {
      console.error(
        'An error occured when user '+req.user.id+
        ' tried to access Teamview page: '+error
      );
      req.session.flash_error('Failed to access Teamview page. Please contact administrator.');
      if (error.hasOwnProperty('user_message')) {
        req.session.flash_error(error.user_message);
      }
      return res.redirect_with_session('/');
    });

});

router.get('/feeds/', function(req, res){
  req.user
    .getFeeds()
    .then(function(feeds){

      return Promise.join(
        promise_feed_of_type({user : req.user, feeds: feeds, type : 'calendar'}),
        promise_feed_of_type({user : req.user, feeds: feeds, type : 'teamview'}),
        function(calendar_feed, team_view_feed){
          res.render('feeds_list', {
            title         : 'My feeds',
            calendar_feed : calendar_feed,
            team_view_feed: team_view_feed,
            current_host  : req.get('host'),
          });
      });

    });
});

router.post('/feeds/regenerate/', function(req, res){
  var model = req.app.get('db_model');

  req.user
    .getFeeds()
    .then(function(feeds){
      var the_feed = _.findWhere(feeds, { feed_token : req.body['token'] });

      if (the_feed) {

        return model.UserFeed.promise_new_feed({
          user : req.user,
          type : the_feed.type,
        });
      }

      return Promise.resolve();
    })
    .then(function(){
        req.session.flash_message('Feed was regenerated');
        return res.redirect_with_session('/calendar/feeds/');
    });
});

// Fetch or create new feed feed provided types
function promise_feed_of_type(args) {
  var type = args.type,
      user = args.user,
      feeds= args.feeds,
      feed = _.findWhere(feeds, { type : type }),
      feed_promise;

  if (! feed) {
    feed_promise = user.sequelize.models.UserFeed.promise_new_feed({
      user : user,
      type : type,
    });
  } else {
    feed_promise = Promise.resolve( feed );
  }

  return feed_promise;
}

router.get('/leave-summary/:leaveId/', async (req, res) => {
  const actingUser = req.user;
  const leaveId = validator.trim(req.params['leaveId']);
  const dbModel = req.app.get('db_model');

  try {
    const leave = await getLeaveForUserView({actingUser, leaveId, dbModel});
    const extendedView = await doesUserHasExtendedViewOfLeave({user: actingUser, leave});
    if (extendedView) {
      const user = await leave.getUser();
      await user.promise_schedule_I_obey();
      const [extendedLeave] = await user.promise_my_leaves({ignore_year: true, filter: {id: leave.id}});
      const leaveDetails = leaveIntoObject(extendedLeave);
      const comments = await getCommentsForLeave({leave});

      leaveDetails.commentsString = comments.map(({comment}) => comment).join('<br>');

      return res.render('leave/popup_leave_details', {
        leave: leaveDetails,
        layout: false,
      });
    } else {
      // return res.send('Short');
      const leaveDetails = leaveIntoObject(leave);
      return res.render('leave/popup_leave_details', {
        leave: leaveDetails,
        layout: false,
        limitedView: true,
      });
    }
  } catch (error) {
    console.log(`Failed to obtain Leave [${leaveId}] summary: ${error} at ${error.stack}`);
    return res.send('Failed to get leave details...');
  }

  return res.send('Failed to get leave details (should never happen)...');
});

module.exports = router;
