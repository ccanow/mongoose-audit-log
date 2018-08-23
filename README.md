# mongoose-audit-log

**mongoose-audit-log** is a mongoose plugin to manage an audit log of changes to the MongoDB database.

## Install

```bash
npm install mongoose-audit-log
```

## Features

* Store changes to entities on persist (save, update, delete)
* Remember the user, that executed the change
* Log when the change has been done


### Storing the current user

In order to collect the information about who actually did a change to an entity, the user information is mandatory.
This can be set on a per usage (1) or global (2) level:

1. Set the current user on an entity right before persisting:

```javascript
...
Order.findById(123)
  .then(order => {
    order.__user = 'me@test.de';
    order.amount = 1000;
  })
  .save();
```

2. Override the getUser-handler on application start:
```javascript
// [audit.js] required on startup (e.g. in the server.js/app.js)
const auditLog = require('mongoose-audit-log').plugin;
// the userContext is a request-bound object, that is updated before the request is handled by a controller/route
const userContext = require('./passport').userContext;

module.exports = () => {
  auditLog.getUser = () => userContext.user.id;
};

---

// [anywhere]
...
Order.findById(123)
  .then(order => {
    order.amount = 1000;
  })
  .save();
```

## Query history

Please find below an example route, to request the history of a given type and id:

```javascript
const Audit = require('mongoose-audit-log').model;
const User = require('../models/User');

router.get('/api/users/:id/history', (req, res, next) => {
  const itemName = User.collection.collectionName;
  Audit.find({ itemId: req.params.id, itemName })
    .then(history => res.json(history))
    .catch(next);
});
```
