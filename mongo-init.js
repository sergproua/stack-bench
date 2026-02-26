function waitForMongo() {
  for (let i = 0; i < 30; i += 1) {
    try {
      db.adminCommand({ ping: 1 });
      return true;
    } catch (error) {
      sleep(1000);
    }
  }
  return false;
}

function init() {
  print('Initializing replica set...');
  rs.initiate({
    _id: 'rs0',
    members: [
      { _id: 0, host: desiredHost }
    ]
  });
}

const desiredHost = (typeof process !== 'undefined' && process.env && process.env.MONGO_REPLICA_HOST)
  ? process.env.MONGO_REPLICA_HOST
  : 'localhost:27017';

if (!waitForMongo()) {
  print('Mongo did not become ready in time');
} else {
  try {
    const status = rs.status();
    if (status.ok === 1) {
      try {
        const conf = rs.conf();
        if (conf?.members?.[0]?.host && conf.members[0].host !== desiredHost) {
          print(`Reconfiguring replica set host from ${conf.members[0].host} to ${desiredHost}`);
          conf.members[0].host = desiredHost;
          conf.version = (conf.version || 1) + 1;
          rs.reconfig(conf, { force: true });
        } else {
          print('Replica set already initialized');
        }
      } catch (reconfigError) {
        print('Replica set already initialized');
      }
    } else {
      init()
    }
  } catch (error) {
    // not initialized
    init()
  }
}
