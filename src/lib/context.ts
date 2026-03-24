import TelegramBot from 'node-telegram-bot-api';
import Modem from '../modem';
import LandlineDatabase from '../database';

export interface IAppContext {
	bot: TelegramBot;
	database: LandlineDatabase;
	modem: Modem;
}
