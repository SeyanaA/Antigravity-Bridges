import { ensureService, api } from '../core/client.mjs';
import { config } from '../core/settings.mjs';
const command = process.argv[2];
if (command === 'start') { await ensureService(); console.log(`监控地址：http://127.0.0.1:${config().port}/`); }
else if (command === 'stop') console.log(await api('admin', '/admin/stop', {}));
else throw new Error('Usage: node scripts/control.mjs start|stop');
