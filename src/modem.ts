import {SerialPort, ReadlineParser} from 'serialport';
import {delay} from "lodash";

export interface IModemParameters {
	path: string;
	baudRate: number;
	delimiterRead: string;
	delimiterWrite: string;
	timeout: number;
	delay: number;
	isLogEnabled: boolean;
	log: (chunk: string) => void;
}

export interface IModemRequest {
	command: string;
	terminators?: (string | RegExp)[];
	timeout?: number;
	delay?: number;
	isValidTimeout?: boolean;
}

export interface IModemResponse {
	command: string;
	response: string[];
	reason: 'response' | 'timeout',
	timeStart: Date;
	timeEnd: Date;
}

export default class Modem {
	public static PARAMETERS: IModemParameters = {
		path: '/dev/ttyACM0',
		baudRate: 9600,
		delimiterRead: '\r\n',
		delimiterWrite: '\r\n',
		timeout: 10000,
		delay: 100,
		isLogEnabled: true,
		log: (chunk: string): void => console.log(`MODEM: ${chunk}`),
	};

	protected readonly $port: SerialPort;

	protected readonly $parameters: IModemParameters;

	private _isProcessing: boolean = false;

	private readonly _outOfProcessingParser: ReadlineParser;

	public constructor (parameters: Partial<IModemParameters>) {
		this.$parameters = Object.assign({}, Modem.PARAMETERS, parameters);

		this.$port = new SerialPort({
			path: this.$parameters.path,
			baudRate: this.$parameters.baudRate,
			parity: 'none',
			dataBits: 8,
			stopBits: 1,
		});

		this._outOfProcessingParser = (
			(new ReadlineParser({
				delimiter: this.$parameters.delimiterRead,
				includeDelimiter: false,
			}))
				.on('data', this._handleOutOfProcessingChunk)
		);

		this.$port.pipe(this._outOfProcessingParser);
	}

	private _handleOutOfProcessingChunk = (chunk: string): void => {
		this._log(['?<?', chunk].join(' '));
	}

	private _log(chunk: string): void {
		if (!this.$parameters.isLogEnabled) {
			return;
		}

		this.$parameters.log(chunk);
	}

	public async send(request: IModemRequest): Promise<IModemResponse> {
		if (this._isProcessing) {
			return Promise.reject(new Error('Modem is processing another request'));
		}

		this._isProcessing = true;

		const command = [request.command, this.$parameters.delimiterWrite].join('').toUpperCase();
		const terminators = (request?.terminators || ['OK']).map(terminator => terminator === String(terminator) ? terminator.toUpperCase() : terminator);
		const timeout = Number.isFinite(request?.timeout) && request?.timeout as number >= 0 ? request?.timeout : this.$parameters.timeout;
		const delay = Number.isFinite(request?.delay) ? request?.delay : this.$parameters.delay;

		const parser = new ReadlineParser({
			delimiter: this.$parameters.delimiterRead,
			includeDelimiter: false,
		});

		const timeStart = new Date();
		let timeoutId: NodeJS.Timeout | number | undefined;

		return (
			new Promise((resolve => setTimeout(resolve, delay)))
				.then(() => {
					this.$port.unpipe(this._outOfProcessingParser);
				})
				.then(() => new Promise<void>((resolve, reject) => {
					if (this.$port.isOpen) {
						return resolve();
					}

					this.$port.open((error) => {
						(!error ? resolve() : reject(error));
					})
				}))
				.then(() => new Promise<void>((resolve, reject) => {
					this.$port.drain((error) => {
						(!error ? resolve() : reject(new Error(['Drain operation failed.', error.message || error.toString()].join(' '))));
					});
				}))
				.then(() => new Promise<void>((resolve, reject) => {
					this.$port.flush((error) => {
						(!error ? resolve() : reject(new Error(['Flush operation failed.', error.message || error.toString()].join(' '))));
					});
				}))
				.then(() => Promise.race<IModemResponse>([
					(
						new Promise<string[]>((resolve, reject) => {
							const response: string[] = [];

							parser.on('data', (chunk) => {
								chunk = chunk.trim();

								this._log(['<<<', chunk].join(' '));

								response.push(chunk);

								if (terminators.some(terminator => typeof terminator === 'string' ? chunk === terminator.trim() : terminator.test(chunk))) {
									resolve(response);
								}
							});

							this.$port.pipe(parser);

							this.$port.write(command, (error) => {
								this._log(['>>>', command.trim()].join(' '));
								(!!error && reject(new Error(['Write operation failed.', error.message || error.toString()].join(' '))));
							});
						})
							.then((response) => {
								return {
									command: command.trim(),
									response: response,
									reason: 'response',
									timeStart: timeStart,
									timeEnd: new Date(),
								} as IModemResponse;
							})
					),
					new Promise<IModemResponse>((resolve, reject) => {
						timeoutId = setTimeout(() => {
							clearTimeout(timeoutId as number);
							timeoutId = undefined;

							if (!request?.isValidTimeout) {
								return reject(
									new Error([
										`Timeout ${timeout} ms is reached for command "${command.trim()}"`,
										`without any of expected responses: ${terminators.join(', ')}`,
									].join(' '))
								);
							}

							resolve({
								command: command.trim(),
								response: [],
								reason: 'timeout',
								timeStart: timeStart,
								timeEnd: new Date(),
							});
						});
					}),
				]))
				.finally(() => {
					if (!!timeoutId) {
						clearTimeout(timeoutId as number);
					}

					this.$port
						.unpipe(parser)
						.pipe(this._outOfProcessingParser);

					this._isProcessing = false;
				})
		);
	}

	public close(): Promise<void> {
		if (!this.$port.isOpen) {
			return Promise.resolve();
		}

		return new Promise((resolve, reject) => {
			this.$port.close((error) => {
				(!error ? resolve() : reject(error));
			});
		});
	}
}
