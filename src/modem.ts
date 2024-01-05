import {SerialPort, SerialPortMock, ReadlineParser} from "serialport";

import * as C from './constants';

export interface IModemParameters {
	path: string;
	baudRate: number;
	timeout: number;
	eol: string;
}

export interface IModemStatus {
	isOpen: boolean;
}

export class Modem {
	public static PARAMETERS = {
		path: '/dev/ttyACM0',
		baudRate: 9600,
		timeout: 1000,
		eol: '\r\n',
	};

	protected readonly $port: (SerialPort | SerialPortMock);

	protected readonly $parameters: IModemParameters;

	protected readonly $status: IModemStatus = {
		isOpen: false,
	};

	protected readonly $timeoutIds: Map<string, number | NodeJS.Timeout> = new Map();

	public constructor(parameters: Partial<IModemParameters>) {
		this.$parameters = Object.assign({}, Modem.PARAMETERS, parameters);

		this.$port = this.$createPort();
	}

	protected $createPort(): (SerialPort | SerialPortMock) {
		const parameters = {
			path: this.$parameters.path,
			baudRate: this.$parameters.baudRate,
			parity: 'none' as 'none',
		}

		const port = ((isProduction) => {
			if (!isProduction) {
				SerialPortMock.binding.createPort(this.$parameters.path, {
					manufacturer: 'ZyXel',
					productId: '1608',
					vendorId: '45549',
					echo: false,
					record: true,
				});

				const port = new SerialPortMock(parameters);

				let lastWrite: string;

				const mock = () => {
					clearTimeout(this.$timeoutIds.get('mock') as number);

					const write = (port.port?.lastWrite as Buffer)?.toString('utf8') || '';

					const answer: string[] = ((write, isChange) => {
						if (!isChange) {
							return [];
						}

						if (write.startsWith('ATZ')) {
							return ['OK'];
						}

						if (write.startsWith('AT+FCLASS')) {
							return ['OK'];
						}

						if (write.startsWith('ATL')) {
							return ['OK'];
						}

						if (write.startsWith('ATA')) {
							return ['ATA', 'VCON'];
						}

						if (write.startsWith('ATH')) {
							return ['OK'];
						}

						if (/^AT(?:.)+?DT/.test(write)) {
							return [write.trim(), 'BUSY'];
						}

						return [];
					})(write, write !== lastWrite)

					if (answer.length) {
						port.port?.emitData(Buffer.from(answer.join(this.$parameters.eol) + this.$parameters.eol, 'utf8'));
						console.info('stream', write, lastWrite);
					}

					lastWrite = write;

					this.$timeoutIds.set('mock', setTimeout(mock, Math.round((port.port?.lastWrite?.length || this.$parameters.baudRate / 8) / (this.$parameters.baudRate / 8)) * 1000));
				};

				this.$timeoutIds.set('mock', setTimeout(mock, 0));

				return port;
			}

			return new SerialPort(parameters);
		})(C.ENV.IS_PRODUCTION);

		port.on('open', (error) => {
			this.$status.isOpen = !error;
		});

		return port;
	}

	public send(packet: {message: string, terminator?: string}): Promise<string> {
		if (!this.$status.isOpen) {
			return Promise.reject(new Error('No open connection'));
		}

		return new Promise((resolve, reject) => {
			const parser = new ReadlineParser({
				delimiter: this.$parameters.eol,
			});

			const data: string[] = [];

			parser.on('data', chunk => {
				data.push(chunk.trim());

				console.info('chunk', data);

				if (!!packet.terminator) {
					if (chunk.trim() !== packet.terminator) {
						return;
					}

					this.$port?.unpipe(parser);
					resolve(data.join('\n'));
				}
				else {
					setTimeout(() => {
						this.$port?.unpipe(parser);
						resolve(data.join('\n'));
					}, this.$parameters.timeout);
				}
			});

			this.$port?.pipe(parser);

			this.$port.write([packet.message, this.$parameters.eol].join(''), (error) => {
				if (!!error) {
					return reject(error);
				}
			});
		});
	}
}
