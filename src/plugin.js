var deepDiff = require('deep-diff');
const Audit = require('./model');

const filter = (path, key) => path.length === 0 && ~['_id', '__v', 'createdAt', 'updatedAt'].indexOf(key);

const isEmpty = value =>
  value === undefined ||
  value === null ||
  (typeof value === 'object' && Object.keys(value).length === 0) ||
  (typeof value === 'string' && value.trim().length === 0);

const types = {
  add: 'Add',
  edit: 'Edit',
  delete: 'Delete'
};

const extractArray = (data, path) => {
  if (path.length === 1) {
    return data[path[0]];
  }
  const parts = [].concat(path);
  const last = parts.pop();
  const value = parts.reduce((current, part) => {
    return current ? current[part] : undefined;
  }, data);
  return value ? value[last] : undefined;
};

const addAuditLogObject = (currentObject, original) => {
  const user = currentObject.__user || module.exports.getUser();

  if (!user) {
    throw new Error('User missing in audit log!');
  }

  delete currentObject.__user;

  const changes = deepDiff(
    JSON.parse(JSON.stringify(original)),
    JSON.parse(JSON.stringify(currentObject)),
    filter
  );

  if (changes && changes.length) {
    return new Audit({
      itemId: currentObject._id,
      itemName: currentObject.constructor.modelName,
      changes: changes.reduce((obj, change) => {
        const key = change.path.join('.');
        if (change.kind === 'D') {
          handleAudits(change.lhs, 'from', types.delete, obj, key);
        } else if (change.kind === 'N') {
          handleAudits(change.rhs, 'to', types.add, obj, key);
        } else if (change.kind === 'A') {
          if (!obj[key] && change.path.length) {
            const data = {
              from: extractArray(original, change.path),
              to: extractArray(currentObject, change.path)
            };
            if (data.from.length && data.to.length) {
              data.type = types.edit;
            } else if (data.from.length) {
              data.type = types.delete;
            } else if (data.to.length) {
              data.type = types.add;
            }
            obj[key] = data;
          }
        } else {
          obj[key] = {
            from: change.lhs,
            to: change.rhs,
            type: types.edit
          };
        }
        return obj;
      }, {}),
      user
    }).save();
  }
  return Promise.resolve();
};

const handleAudits = (changes, target, type, obj, key) => {
  if (typeof changes === 'object') {
    if (Object.keys(changes).filter(key => key === '_id' || key === 'id').length) {
      // entity found
      obj[key] = { [target]: changes, type };
    } else {
      // sibling/sub-object
      Object.entries(changes).forEach(([sub, value]) => {
        if (!isEmpty(value)) {
          obj[`${key}.${sub}`] = { [target]: value, type };
        }
      });
    }
  } else {
    // primitive value
    obj[key] = { [target]: changes, type };
  }
}

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
  const orig = Object.assign({}, currentObject._doc || currentObject);
  orig.constructor.modelName = currentObject.constructor.modelName;
  return addAuditLogObject({
    _id: currentObject._id,
    __user: options.__user
  }, orig)
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
const plugin = function Audit(schema) {
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
