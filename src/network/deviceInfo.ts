import Packet from './packet';
import safeishJSON from './safeishJSON';
import Tokens from "./tokens";

const ERRORS = {
	'-5001': (method, args, err) => err.message === 'invalid_arg' ? 'Invalid argument' : err.message,
	'-5005': (method, args, err) => err.message === 'params error' ? 'Invalid argument' : err.message,
	'-10000': (method) => 'Method `' + method + '` is not supported'
};

export class DeviceInfo {
    parent;
    address: String;
    port: String;
    id: any;
    enrichPromise;
    model;
    autoToken;
    enriched;
    handshakePromise;
    handshakeResolve;
    handshakeTimeout;

    packet = new Packet();
    lastId = 0;
    promises = new Map();
    tokenChanged = false;

    debug;

	constructor(debug, parent, id, address, port) {
		this.parent = parent;
		this.address = address;
		this.port = port;
		this.id = id;
		this.debug = debug;
	}

	get token() {
		return this.packet.token;
	}

	set token(t) {
		this.debug('Using manual token:', t.toString('hex'));
		this.packet.token = t;
		this.tokenChanged = true;
	}

	/**
	 * Enrich this device with detailed information about the model. This will
	 * simply call miIO.info.
	 */
	enrich() {
		if(! this.id) {
			throw new Error('Device has no identifier yet, handshake needed');
		}

		if(this.model && ! this.tokenChanged && this.packet.token) {
			// This device has model info and a valid token
			return Promise.resolve();
		}

		if(this.enrichPromise) {
			// If enrichment is already happening
			return this.enrichPromise;
		}

		// Check if there is a token available, otherwise try to resolve it
		let promise;
		if(! this.packet.token) {
			// No automatic token found - see if we have a stored one
			this.debug('Loading token from storage, device hides token and no token set via options');
			this.autoToken = false;
			promise = Tokens.get(this.id)
				.then(token => this.token = Buffer.from(token, 'hex'));
		} else {
			if(this.tokenChanged) {
				this.autoToken = false;
			} else {
				this.autoToken = true;
				this.debug('Using automatic token:', this.packet.token.toString('hex'));
			}
			promise = Promise.resolve();
		}

		return this.enrichPromise = promise
			.then(() => this.call('miIO.info'))
			.then(data => {
				this.enriched = true;
				this.model = data.model;
				this.tokenChanged = false;

				this.enrichPromise = null;
			})
			.catch(err => {
				this.enrichPromise = null;
				this.enriched = true;

				if(err.code === 'missing-token') {
					// Rethrow some errors
					throw err;
				}

				if(this.packet.token) {
					// Could not call the info method, this might be either a timeout or a token problem
					const e = new DeviceError('Could not connect to device, token might be wrong');
					e.code = 'connection-failure';
					e.device = this;
					throw e;
				} else {
					const e = new DeviceError('Could not connect to device, token needs to be specified');
					e.code = 'missing-token';
					e.device = this;
					throw e;
				}
			});
	}

	onMessage(msg) {
		try {
			this.packet.raw = msg;
		} catch(ex) {
			this.debug('<- Unable to parse packet', ex);
			return;
		}

		let data = this.packet.data;
		if(data === null) {
			this.debug('<-', 'Handshake reply:', this.packet.checksum);
			this.packet.handleHandshakeReply();

			if(this.handshakeResolve) {
				this.handshakeResolve();
			}
		} else {
			// Handle null-terminated strings
			if(data[data.length - 1] === 0) {
				data = data.slice(0, data.length - 1);
			}

			// Parse and handle the JSON message
			let str = data.toString('utf8');

			// Remove non-printable characters to help with invalid JSON from devices
			str = str.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, ''); // eslint-disable-line

			this.debug('<- Message: `' + str + '`');
			try {
				let object = safeishJSON(str);

				const p = this.promises.get(object.id);
				if(! p) return;
				if(typeof object.result !== 'undefined') {
					p.resolve(object.result);
				} else {
					p.reject(object.error);
				}
			} catch(ex) {
				this.debug('<- Invalid JSON', ex);
			}
		}
	}

	handshake() {
		if(! this.packet.needsHandshake) {
			return Promise.resolve(this.token);
		}

		// If a handshake is already in progress use it
		if(this.handshakePromise) {
			return this.handshakePromise;
		}

		return this.handshakePromise = new Promise<void>((resolve, reject) => {
			// Create and send the handshake data
			this.packet.handshake();
			const data = this.packet.raw;
			this.parent.socket.send(data, 0, data.length, this.port, this.address, err => err && reject(err));

			// Handler called when a reply to the handshake is received
			this.handshakeResolve = () => {
				clearTimeout(this.handshakeTimeout);
				this.handshakeResolve = null;
				this.handshakeTimeout = null;
				this.handshakePromise = null;

				if(this.id !== this.packet.deviceId) {
					// Update the identifier if needed
					this.id = this.packet.deviceId;
					//this.debug = debug('thing:miio:' + this.id);
					this.debug('Identifier of device updated');
				}

				if(this.packet.token) {
					resolve();
				} else {
					const err = new DeviceError('Could not connect to device, token needs to be specified');
					err.code = 'missing-token';
					reject(err);
				}
			};

			// Timeout for the handshake
			this.handshakeTimeout = setTimeout(() => {
				this.handshakeResolve = null;
				this.handshakeTimeout = null;
				this.handshakePromise = null;

				const err = new DeviceError('Could not connect to device, handshake timeout');
				err.code = 'timeout';
				reject(err);
			}, 2000);
		});
	}

	call(method, args:any = [], options:any = null) {
		let request:any = {
			method: method
		};

		if(args !== false) request.params = args;

		if(options && options.sid) {
			// If we have a sub-device set it (used by Lumi Smart Home Gateway)
			request.sid = options.sid;
		}

		return new Promise((resolve, reject) => {
			let resolved = false;

			// Handler for incoming messages
			const promise = {
				resolve: res => {
					resolved = true;
					this.promises.delete(request.id);

					resolve(res);
				},
				reject: err => {
					resolved = true;
					this.promises.delete(request.id);

					if(! (err instanceof Error) && typeof err.code !== 'undefined') {
						const code = err.code;

						const handler = ERRORS[code];
						let msg;
						if(handler) {
							msg = handler(method, args, err.message);
						} else {
							msg = err.message || err.toString();
						}

						err = new Error(msg);
						err.code = code;
					}
					reject(err);
				}
			};

			let retriesLeft = (options && options.retries) || 5;
			const retry = () => {
				if(retriesLeft-- > 0) {
					send();
				} else {
					const err = new DeviceError('Call to device timed out');
					err.code = 'timeout';
					promise.reject(err);
				}
			};

			const send = () => {
				if(resolved) return;

				this.handshake()
					.catch(err => {
						if(err.code === 'timeout') {
							this.debug('<- Handshake timed out');
							retry();
							return false;
						} else {
							throw err;
						}
					})
					.then(token => {
						// Token has timed out - handled via retry
						if(! token) return;

						// Assign the identifier before each send
						let id;
						if(request.id) {
							/*
							 * This is a failure, increase the last id. Should
							 * increase the chances of the new request to
							 * succeed. Related to issues with the vacuum
							 * not responding such as described in issue #94.
							 */
							id = this.lastId + 100;

							// Make sure to remove the failed promise
							this.promises.delete(request.id);
						} else {
							id = this.lastId + 1;
						}

						// Check that the id hasn't rolled over
						if(id >= 10000) {
							this.lastId = id = 1;
						} else {
							this.lastId = id;
						}

						// Assign the identifier
						request.id = id;

						// Store reference to the promise so reply can be received
						this.promises.set(id, promise);

						// Create the JSON and send it
						const json = JSON.stringify(request);
						this.debug('-> (' + retriesLeft + ')', json);
						this.packet.data = Buffer.from(json, 'utf8');

						const data = this.packet.raw;

						this.parent.socket.send(data, 0, data.length, this.port, this.address, err => err && promise.reject(err));

						// Queue a retry in 2 seconds
						setTimeout(retry, 2000);
					})
					.catch(promise.reject);
			};

			send();
		});
	}
}

class DeviceError extends Error {
    code;
    device;
}