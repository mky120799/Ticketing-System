exports.shorthands = undefined;
// Records when a row was claimed so a dispatcher that crashed mid-publish can be detected and its rows released.
exports.up = (pgm) => {
  pgm.addColumn('integration_outbox', { claimed_at: { type: 'timestamptz' } });
  pgm.createIndex('integration_outbox', ['claimed_at'], { where: "status = 'in_flight'", name: 'integration_outbox_in_flight_idx' });
};
exports.down = (pgm) => {
  pgm.dropIndex('integration_outbox', ['claimed_at'], { name: 'integration_outbox_in_flight_idx' });
  pgm.dropColumn('integration_outbox', 'claimed_at');
};
