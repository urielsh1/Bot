// server.js - Bot WhatsApp con .codigo + verificación por código
// Para Render + GitHub
// Instalar: npm install whatsapp-web.js qrcode-terminal express cors dotenv

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '524891134390'; // sin +
const BOT_NUMBER = process.env.BOT_NUMBER || ''; // número del bot, ej: 524891134390

// --- Estado en memoria ---
let qrCode = null;
let isReady = false;
let clientInfo = null;
let pendingCodes = {}; // { numero: { code, expires } }

// Genera código de 6 dígitos
function generarCodigo() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// --- Cliente WhatsApp ---
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  }
});

client.on('qr', (qr) => {
  qrCode = qr;
  isReady = false;
  console.log('Escanea este QR con WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  isReady = true;
  qrCode = null;
  clientInfo = client.info;
  console.log('✅ Bot conectado como:', clientInfo.wid.user);
});

client.on('auth_failure', (m) => console.log('❌ Auth falló:', m));
client.on('disconnected', (r) => { console.log('Desconectado:', r); isReady = false; });

client.initialize();

// --- PRIMER COMANDO: .codigo ---
client.on('message', async (msg) => {
  const texto = msg.body.trim().toLowerCase();
  const chat = await msg.getChat();
  const remitente = msg.from.replace('@c.us', ''); // número sin @c.us

  // .codigo -> muestra número + genera código de verificación
  if (texto === '.codigo') {
    const codigo = generarCodigo();
    pendingCodes[remitente] = { code: codigo, expires: Date.now() + 5 * 60 * 1000 };

    const respuesta = `📱 *Mi WhatsApp:* +${WHATSAPP_NUMBER}\n\n🔐 *Tu código de verificación es:* *${codigo}*\n\nEscríbeme \`.verificar ${codigo}\` para conectar tu cuenta.\n⏰ Expira en 5 minutos.`;
    await msg.reply(respuesta);
    console.log(`.codigo de ${remitente} -> código ${codigo}`);
    return;
  }

  // .verificar 123456 -> valida código
  if (texto.startsWith('.verificar')) {
    const partes = texto.split(' ');
    const codigoIngresado = partes[1];
    const guardado = pendingCodes[remitente];

    if (!guardado) {
      await msg.reply('❌ No tienes código pendiente. Escribe `.codigo` primero.');
      return;
    }
    if (Date.now() > guardado.expires) {
      delete pendingCodes[remitente];
      await msg.reply('⏰ Tu código expiró. Escribe `.codigo` de nuevo.');
      return;
    }
    if (codigoIngresado === guardado.code) {
      delete pendingCodes[remitente];
      await msg.reply(`✅ *¡Conectado!* 🎉\nTu número +${remitente} quedó verificado y vinculado al bot.`);
      // Aquí puedes guardar en DB: remitente verificado
      return;
    } else {
      await msg.reply('❌ Código incorrecto. Intenta de nuevo.');
      return;
    }
  }

  if (texto === '.ping') await msg.reply('🏓 ¡Pong! Bot en línea.');
  if (texto === '.ayuda') await msg.reply('Comandos:\n.codigo - Muestra WhatsApp y te da código\n.verificar 123456 - Verifica tu código\n.ping - Revisa si estoy en línea');
});

// --- API para tu PANEL / APP ---
// GET /status -> sabe si el bot está conectado
app.get('/status', (req, res) => {
  res.json({ ready: isReady, qr: qrCode ? true : false, bot: clientInfo?.wid?.user || null, whatsapp_number: WHATSAPP_NUMBER });
});

// GET /qr -> tu app muestra el QR para conectar
app.get('/qr', (req, res) => {
  if (isReady) return res.json({ ready: true, message: 'Ya conectado' });
  if (!qrCode) return res.json({ ready: false, message: 'Generando QR...' });
  res.json({ ready: false, qr: qrCode });
});

// POST /send-codigo { numero: "524891134390" } -> tu panel manda .codigo a ese número
app.post('/send-codigo', async (req, res) => {
  try {
    const numero = (req.body.numero || WHATSAPP_NUMBER).replace(/\D/g, '');
    const codigo = generarCodigo();
    pendingCodes[numero] = { code: codigo, expires: Date.now() + 5 * 60 * 1000 };
    const chatId = numero + '@c.us';
    await client.sendMessage(chatId, `📱 Bot WhatsApp\n\n🔐 Tu código de verificación es: *${codigo}*\nEscríbeme \`.verificar ${codigo}\` para conectar.\n⏰ Expira en 5 minutos.`);
    res.json({ ok: true, numero, codigo, message: 'Código enviado a WhatsApp' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /verificar { numero, codigo } -> tu app verifica desde el panel
app.post('/verificar', (req, res) => {
  const numero = (req.body.numero || '').replace(/\D/g, '');
  const codigo = String(req.body.codigo || '');
  const guardado = pendingCodes[numero];
  if (!guardado) return res.json({ ok: false, message: 'Sin código pendiente. Pide .codigo primero.' });
  if (Date.now() > guardado.expires) { delete pendingCodes[numero]; return res.json({ ok: false, message: 'Código expirado' }); }
  if (codigo === guardado.code) { delete pendingCodes[numero]; return res.json({ ok: true, message: 'Verificado ✅' }); }
  res.json({ ok: false, message: 'Código incorrecto' });
});

app.get('/', (req, res) => res.send('Bot WhatsApp corriendo ✅ - /status /qr /send-codigo'));

app.listen(PORT, () => console.log(`🌐 Server en puerto ${PORT}`));
