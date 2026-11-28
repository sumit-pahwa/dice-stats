import { makePgStore } from '../lib/pg-store.js';
import { measurementsHandler } from '../lib/handlers.js';

export default measurementsHandler(makePgStore());
