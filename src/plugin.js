var deepDiff = require('deep-diff');
const Audit = require('./model');

const filter = (path, key) => path.length === 0 && ~['_id', '__v', 'createdAt', 'updatedAt'].indexOf(key);

const addAuditLogObject = (currentObject, original) => {
  const user = currentObject.__user || module.exports.getUser();

  if (!user) {
    throw new Error('User missing in audit log!');
  }

  delete currentObject.__user;

  const changes = deepDiff(
    JSON.parse(JSON.stringify(currentObject)),
    JSON.parse(JSON.stringify(original)),
    filter
  );

  if (changes && changes.length) {
    return new Audit({
      itemId: currentObject._id,
      itemName: currentObject.constructor.modelName,
      changes: changes.reduce((obj, change) => {
        const key = change.path.join('.');
        obj[key] = {
          from: change.rhs,
          to: change.lhs,
          type: change.kind
        };
        if (change.kind === 'D') {
          obj[key] = {
            from: change.lhs,
            type: 'Delete'
          };
        } else {
          obj[key] = {
            from: change.rhs,
            to: change.lhs,
            type: 'Edit'
          };
        }
        return obj;
      }, {}),
      user
    }).save();
  }
  return Promise.resolve();
};

const addAuditLog = (currentObject, next) => {
  currentObject.constructor
    .findOne({ _id: currentObject._id })
    .then(original => addAuditLogObject(currentObject, original))
    .then(() => next())
    .catch(next);
};

const flattenObject = (obj) => Object.keys(obj).reduce((data, key) => {
  if (key.indexOf('$') === 0) {
    Object.assign(data, obj[key]);
  } else {
    data[key] = obj[key];
  }
  return data;
}, {});

const addUpdate = (query, next, multi) => {
  const updated = flattenObject(query._update);
  let counter = 0;
  return query.find(query._conditions)
    .lean(true)
    .cursor()
    .eachAsync(fromDb => {
      if (!multi && counter++) {
        // handle 'multi: false'
        return next();
      }
      const orig = Object.assign({ __user: query.options.__user }, fromDb, updated);
      orig.constructor.modelName = query._collection.collectionName;
      return addAuditLogObject(orig, fromDb);
    })
    .then(() => next())
    .catch(next);
};

const addDelete = (currentObject, options, next) => {
  const orig = Object.assign({ __user: options.__user }, currentObject._doc || currentObject);
  orig.constructor.modelName = currentObject.constructor.modelName;
  return addAuditLogObject(orig, {})
    .then(() => next())
    .catch(next);
};

const addFindAndDelete = (query, next) => {
  query.find()
    .lean(true)
    .cursor()
    .eachAsync(fromDb => {
      return addDelete(fromDb, query.options, next);
    })
    .then(() => next())
    .catch(next);
};

/**
 * @param {Object} schema - Mongoose schema object
 */
const plugin = function (schema) {
  schema.pre('save', function (next) {
    if (this.isNew) {
      return next();
    }
    addAuditLog(this, next);
  });

  schema.pre('update', function (next) {
    addUpdate(this, next, !!this.options.multi);
  });

  schema.pre('updateOne', function (next) {
    addUpdate(this, next, false);
  });

  schema.pre('findOneAndUpdate', function (next) {
    addUpdate(this, next, false);
  });

  schema.pre('updateMany', function (next) {
    addUpdate(this, next, true);
  });

  schema.pre('replaceOne', function (next) {
    addUpdate(this, next, false);
  });

  schema.pre('remove', function (next, options) {
    addDelete(this, options, next);
  });

  schema.pre('findOneAndDelete', function (next) {
    addFindAndDelete(this, next);
  });

  schema.pre('findOneAndRemove', function (next) {
    addFindAndDelete(this, next);
  });
};

module.exports = plugin;
module.exports.getUser = () => undefined;
