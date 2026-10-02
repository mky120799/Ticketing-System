exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.addColumn('approval_requests', {
    communication_id: { type: 'uuid', references: 'ticket_communications', onDelete: 'cascade' }
  });
  pgm.createIndex('approval_requests', ['communication_id'], { unique: true, where: 'communication_id IS NOT NULL' });
};
exports.down = (pgm) => {
  pgm.dropIndex('approval_requests', ['communication_id'], { ifExists: true });
  pgm.dropColumn('approval_requests', 'communication_id');
};
