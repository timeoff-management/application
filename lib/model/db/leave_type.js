"use strict";

module.exports = function(sequelize, DataTypes) {
    var LeaveType = sequelize.define("LeaveType", {
        // TODO add validators!
        name : {
            type      : DataTypes.STRING,
            allowNull : false
        },
        color : {
            type         : DataTypes.STRING,
            allowNull    : false,
            defaultValue : '#ffffff',
        },
        use_allowance : {
            type         : DataTypes.BOOLEAN,
            allowNull    : false,
            defaultValue : true,
        },
        limit : {
            type         : DataTypes.INTEGER,
            allowNull    : false,
            defaultValue : 0,
        },
        sort_order : {
          type         : DataTypes.INTEGER,
          allowNull    : false,
          defaultValue : 0,
          comment      : "Is used to determine sorting order of leave types",
        },
        auto_approve : {
            type         : DataTypes.BOOLEAN,
            allowNull    : false,
            defaultValue : false,
        },
    }, {
        classMethods: {
            associate : function( models ) {
                LeaveType.belongsTo(models.Company, {as : 'company'});
                LeaveType.hasMany(models.Leave, {as : 'leaves', foreignKey : 'leaveTypeId'});
            },

            generate_leave_types : function(args){
                var company = args.company;

                return LeaveType.bulkCreate([
                    {
                        name : 'Holiday',
                        color : '#22AA66',
                        companyId : company.id,
                    },
                    {
                        name : 'Sick Leave',
                        color : '#459FF3',
                        companyId : company.id,
                        limit : 10,
                        use_allowance : 0,
                    },
                ])
            },
        },

        instanceMethods : {
          get_color_class : function() {
            let value_in_db = this.color || '';

            return value_in_db.match(/^\s*\#/)
              ? 'leave_type_color_1'
              : value_in_db;
          },

          is_auto_approve : function(){
            return this.auto_approve === true;
          }
        }
    });

    return LeaveType;
};
