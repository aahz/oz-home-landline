import {Message} from 'node-telegram-bot-api';
import {IAppContext} from '../lib/context';
import {executeDialSequence} from '../services/dial-sequence';
import * as C from '../constants';

export const COMMAND_CALL_REGEXP = (/^\/call\s+(?<dial>.+)$/i);

export function handleCall(context: IAppContext, message: Message): void {
	const command = String(message.text || '');
	const data = COMMAND_CALL_REGEXP.exec(command);

	if (!data?.groups?.dial?.trim()) {
		context.bot.sendMessage(message.chat.id, 'Error: Usage /call <dial_sequence>');

		return;
	}

	const dialTarget = data.groups.dial.trim();

	if (!C.ENV.IS_PRODUCTION) {
		console.log(`${Date.now()}: processing call command "${command}"`);
	}

	executeDialSequence(context, {
		entity: message,
		title: 'Call',
		dialTarget,
		logTarget: dialTarget,
		successState: 'done',
	});
}
