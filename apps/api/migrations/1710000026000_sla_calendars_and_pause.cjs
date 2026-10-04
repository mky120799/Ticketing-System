exports.shorthands = undefined;
exports.up = (pgm) => {
  // A policy may count its minutes on the wall clock (default, unchanged behaviour) or in business hours, and may stop
  // the clock while the case waits for the customer.
  pgm.addColumns('sla_policies', {
    calendar: { type: 'varchar(10)', notNull: true, default: 'wall' },
    pause_while_pending_customer: { type: 'boolean', notNull: true, default: false }
  });
  pgm.addConstraint('sla_policies', 'sla_policies_calendar_chk', { check: "calendar IN ('wall','business')" });
  pgm.addColumn('tickets', { sla_paused_at: { type: 'timestamptz' } });

  // Working hours per country. Holidays come from business_holidays.
  pgm.createTable('business_hours', {
    country: { type: 'varchar(2)', primaryKey: true },
    timezone: { type: 'varchar(60)', notNull: true },
    start_minute: { type: 'integer', notNull: true },
    end_minute: { type: 'integer', notNull: true },
    working_days: { type: 'integer[]', notNull: true },
    updated_by: { type: 'varchar(160)', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
  });
  pgm.addConstraint('business_hours', 'business_hours_range_chk', { check: 'start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute' });
  pgm.sql("INSERT INTO business_hours (country,timezone,start_minute,end_minute,working_days,updated_by) VALUES ('AU','Australia/Sydney',540,1020,ARRAY[1,2,3,4,5],'system-seed'), ('IN','Asia/Kolkata',570,1050,ARRAY[1,2,3,4,5],'system-seed')");
};
exports.down = (pgm) => { pgm.dropTable('business_hours'); pgm.dropColumn('tickets', 'sla_paused_at'); pgm.dropConstraint('sla_policies', 'sla_policies_calendar_chk'); pgm.dropColumns('sla_policies', ['calendar', 'pause_while_pending_customer']); };
