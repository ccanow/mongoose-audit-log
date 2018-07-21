const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema({
  itemName: String,
  itemId: mongoose.Schema.Types.ObjectId,
  changes: {},
  user: {}
}, { timestamps: true });

module.exports = mongoose.model('Audit', auditSchema);
