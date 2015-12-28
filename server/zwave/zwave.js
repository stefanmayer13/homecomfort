/**
 * @author <a href="mailto:stefanmayer13@gmail.com">Stefan Mayer</a>
 */

const authentication = require('./authentication');
const devicesApi = require('./devices');
const mongodb = require('../utils/MongoDBHelper');

module.exports = function zwave(log, username, password) {
    log.debug(`Zwave started`);
    const state = {
        cookie: null,
        log,
        db: null,
    };

    return Promise.all([
        mongodb.connect(),
        authentication.login(log, username, password),
    ]).then((results) => {
        log.debug('Connected to mongodb and zwave');
        state.db = results[0];
        state.cookie = results[1];
        return devicesApi.getDevicesInfo(state);
    }).then((data) => {
        // const controller = data.controller;
        const keys = Object.keys(data.devices);
        log.debug(`Found ${keys.length} zwave devices`);
        const devices = keys.map((key) => {
            return {
                _id: key,
                name: data.devices[key].data.givenName.value,
                xml: data.devices[key].data.ZDDXMLFile.value,
                deviceType: data.devices[key].data.deviceTypeString.value,
                isAwake: data.devices[key].data.isAwake.value,
                vendor: data.devices[key].data.vendorString.value,
                temperature: data.devices[key].instances['0'].commandClasses['49'] ? data.devices[key].instances['0'].commandClasses['49'].data['1'].val.value + ' ' + data.devices[key].instances['0'].commandClasses['49'].data['1'].scaleString.value : null,
                battery: data.devices[key].instances['0'].commandClasses['128'] ? data.devices[key].instances['0'].commandClasses['128'].data.last.value : null,
            };
        });

        const xmlRequest = devices.filter((device) => {
            return !!device.xml;
        }).map((device) => {
            return devicesApi.getXml(state, device.xml);
        });

        return Promise.all(xmlRequest).then((xmlData) => {
            return xmlData.map((doc) => {
                const description = doc.object.ZWaveDevice.deviceDescription[0].description[0].lang.reduce((prev, descr) => {
                    prev[descr.$['xml:lang']] = descr._;
                    return prev;
                }, {});
                return {
                    xml: doc.xml,
                    brandName: doc.object.ZWaveDevice.deviceDescription[0].brandName[0],
                    productName: doc.object.ZWaveDevice.deviceDescription[0].productName[0],
                    batteryType: doc.object.ZWaveDevice.deviceDescription[0].batteryType[0],
                    batteryCount: doc.object.ZWaveDevice.deviceDescription[0].batteryCount[0],
                    description,
                    deviceImage: doc.object.ZWaveDevice.resourceLinks[0].deviceImage[0].$.url,
                };
            });
        }).then((deviceDates) => {
            return devices.map((device) => {
                const xmlData = deviceDates.filter((xmlDeviceData) => {
                    return device.xml === xmlDeviceData.xml;
                });
                return Object.assign({}, device, xmlData[0]);
            });
        });
    }).then((devices) => {
        return Promise.all(devices.map((device) => {
            return mongodb.setDevice(state.db, device)
                .then((ret) => {
                    if (ret.upsertedCount === 1) {
                        log.debug(`Added device ${device._id}`);
                    } else if (ret.modifiedCount === 1) {
                        log.debug(`Updated device ${device._id}`);
                    }
                });
        }));
    }).then(() => {
        return new Promise((resolve, reject) => {
            state.db.close((err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    });
};