import TelegramBot from 'node-telegram-bot-api';
import Modem from './modem';
import LandlineDatabase from './database';
import * as C from './constants';
import {IAppContext} from './lib/context';
import {isAdminUser, isAllowedUser, notifyUntrustedCallback, notifyUntrustedMessage, processSecurityCallback} from './lib/security';
import {handleAdminCommandMessage, processAdminFlowCallback, processAdminFlowText, CALLBACK_FORM_PREFIX, sendAdminError} from './commands/admin';
import {COMMAND_OPEN_GATE_REGEXP, openGate, sendGatesList} from './commands/gates';
import {COMMAND_CALL_REGEXP, handleCall} from './commands/call';

const bot = new TelegramBot(C.BOT.TOKEN, {
	polling: true,
});

const database = new LandlineDatabase({
	path: C.DB.PATH,
});

database.initialize({
	adminUserId: C.BOT.ADMIN_USER_ID,
	gatesRawList: C.GATES.RAW_LIST,
});

const modem = new Modem({
	path: C.MODEM.PATH,
	baudRate: C.MODEM.BAUD_RATE,
	isLogEnabled: true,
	delay: 200,
});

const context: IAppContext = {
	bot,
	database,
	modem,
};

bot.on('message', (message) => {
	if (handleAdminCommandMessage(context, message)) {
		return;
	}

	if (processAdminFlowText(context, message)) {
		return;
	}

	if (!isAllowedUser(context, message.from?.id)) {
		notifyUntrustedMessage(context, message);

		return;
	}

	if (COMMAND_OPEN_GATE_REGEXP.test(message.text as string)) {
		if (!C.ENV.IS_PRODUCTION) {
			console.log(`${Date.now()}: Recognized gate open request`);
		}

		return openGate(context, message);
	}

	if (COMMAND_CALL_REGEXP.test(message.text as string)) {
		if (!C.ENV.IS_PRODUCTION) {
			console.log(`${Date.now()}: Recognized call request`);
		}

		return handleCall(context, message);
	}

	if ((/^\/(?:start|gates)/gi).test(message.text as string)) {
		if (!C.ENV.IS_PRODUCTION) {
			console.log(`${Date.now()}: Recognized gates list request`);
		}

		return sendGatesList(context, message);
	}
});

bot.on('callback_query', (query) => {
	if (processSecurityCallback(context, query)) {
		return;
	}

	if (String(query.data || '').startsWith(CALLBACK_FORM_PREFIX)) {
		if (!isAdminUser(context, query.from?.id)) {
			sendAdminError(context, query);
			context.bot.answerCallbackQuery(query.id).catch(() => undefined);

			return;
		}

		if (processAdminFlowCallback(context, query)) {
			return;
		}
	}

	if (!isAllowedUser(context, query.from?.id)) {
		notifyUntrustedCallback(context, query);

		return;
	}

	if (COMMAND_OPEN_GATE_REGEXP.test(query.data as string)) {
		if (!C.ENV.IS_PRODUCTION) {
			console.log(`${Date.now()}: Recognized gate open query`);
		}

		return openGate(context, query);
	}
});
