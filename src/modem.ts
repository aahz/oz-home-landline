import {SerialPort, ReadlineParser} from 'serialport';

export interface IModemParameters {
	path: string;
	baudRate: number;
	delimiterRead: string;
	delimiterWrite: string;
	delay: number;
	isLogEnabled: boolean;
	log: (chunk: string) => void;
}

export interface IModemResponse {
	command: string;
	response: string[];
	timeStart: Date;
	timeEnd: Date;
}

export default class Modem {
	public static PARAMETERS: IModemParameters = {
		path: '/dev/ttyACM0',
		baudRate: 9600,
		delimiterRead: '\r\n',
		delimiterWrite: '\r\n',
		delay: 100,
		isLogEnabled: true,
		log: (chunk: string): void => console.log(`MODEM: ${chunk}`),
	};

	protected readonly $port: SerialPort;

	protected readonly $parser: ReadlineParser;

	protected readonly $parameters: IModemParameters;

	public constructor (parameters: Partial<IModemParameters>) {
		this.$parameters = Object.assign({}, Modem.PARAMETERS, parameters);

		this.$port = new SerialPort({
			path: this.$parameters.path,
			baudRate: this.$parameters.baudRate,
			parity: 'none',
			dataBits: 8,
			stopBits: 1,
		});

		this.$parser = new ReadlineParser({
			delimiter: this.$parameters.delimiterRead,
		});

		this.$port.pipe(this.$parser);

		this.$parser.on('data', this._dataHandler);
	}

	private _dataHandler = (chunk: string): void => {
		this._fallbackHandler(chunk);
	}

	private _fallbackHandler = (chunk: string): void => {
		console.log(`{answer given outside command scope} ${chunk}`);
	}

	private _log(chunk: string): void {
		if (!this.$parameters.isLogEnabled) {
			return;
		}

		this.$parameters.log(chunk);
	}

	public async send(command: string, {terminators = ['OK'], timeout = 1000, delay = this.$parameters.delay} = {}): Promise<IModemResponse> {
		return (
			(
				new Promise((resolve) => {
					setTimeout(resolve, delay)
				})
			)
				.then(() => new Promise((resolve, reject) => {
					const timeStart = new Date();

					const response: string[] = [];
					const errorTimeout = setTimeout(() => {
						this._dataHandler = this._fallbackHandler;
						reject(new Error('Request timed out before a satisfactory answer was given.'));
					}, timeout);

					this.$port.write([command, this.$parameters.delimiterWrite].join(''));

					this._log(`>> ${command}`);

					this._dataHandler = (chunk: string) => {
						response.push(chunk);

						if (terminators.some((terminator) => chunk.includes(terminator))) {
							this._log(`<< ${chunk}`);
							this._dataHandler = this._fallbackHandler;

							clearTimeout(errorTimeout);

							resolve({
								command: command,
								response: response,
								timeStart: timeStart,
								timeEnd: new Date(),
							});
						}
						else {
							this._log(chunk);
						}
					}
				}))
		);
	}

	public close(): void {
		if (!this.$port.isOpen) {
			return;
		}

		this.$port.close();
	}
}
