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

if (!waitForMongo()) {
  print('Mongo did not become ready in time');
} else {
  try {
    const status = rs.status();
    if (status.ok === 1) {
      print('Replica set already initialized');
    }
  } catch (error) {
    print('Initializing replica set...');
    rs.initiate({
      _id: 'rs0',
      members: [
        { _id: 0, host: 'localhost:27017' }
      ]
    });
  }
}
