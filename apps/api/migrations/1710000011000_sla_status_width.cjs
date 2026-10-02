exports.shorthands = undefined;
exports.up = (pgm) => { pgm.alterColumn('tickets', 'sla_status', { type: 'varchar(40)' }); };
exports.down = (pgm) => { pgm.alterColumn('tickets', 'sla_status', { type: 'varchar(20)' }); };
