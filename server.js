// server.js V3 - prende aunque falte Baileys, no se cae
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3000;
const WHATSAPP_NUMBER = (process.env.WHATSAPP_NUMBER || '524891134390').replace(/\D/g,'');
let sock = null, isReady = false, qrText = null, pendingCodes = {}, baileysError = null;
function generarCodigo(){ return Math.floor(100000 + Math.random()*900000).toString(); }
async function startBot(){
  try{
    const baileys = require('@whiskeysockets/baileys');
    const pino = require('pino');
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys;
    const { state, saveCreds } = await useMultiFileAuthState('./auth_baileys');
    sock = makeWASocket({ auth: state, logger: pino({level:'silent'}), printQRInTerminal: false, browser: ['Bot WhatsApp','Chrome','1.0'] });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (u)=>{
      const { connection, lastDisconnect, qr } = u;
      if(qr){ qrText = qr; isReady = false; }
      if(connection === 'open'){ isReady = true; qrText = null; console.log('Bot conectado:', sock.user?.id); }
      if(connection === 'close'){ isReady = false; const s = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut; if(s) setTimeout(startBot, 3000); }
    });
    sock.ev.on('messages.upsert', async ({messages})=>{
      const m = messages[0];
      if(!m?.message || m.key.fromMe) return;
      const texto = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim().toLowerCase();
      const remitente = m.key.remoteJid.replace('@s.whatsapp.net','');
      const reply = async (txt)=>{ await sock.sendMessage(m.key.remoteJid, {text: txt}, {quoted: m}); };
      if(texto === '.codigo'){
        const codigo = generarCodigo();
        pendingCodes[remitente] = {code: codigo, expires: Date.now()+5*60*1000};
        await reply(`📱 *Mi WhatsApp:* +${WHATSAPP_NUMBER}\n\n🔐 *Tu código de verificación es:* *${codigo}*\n\nEscríbeme \`.verificar ${codigo}\` para conectar.\n⏰ Expira en 5 minutos.`);
        return;
      }
      if(texto.startsWith('.verificar')){
        const codigoIngresado = texto.split(' ')[1];
        const guardado = pendingCodes[remitente];
        if(!guardado) return await reply('❌ No tienes código pendiente. Escribe `.codigo` primero.');
        if(Date.now() > guardado.expires){ delete pendingCodes[remitente]; return await reply('⏰ Tu código expiró. Escribe `.codigo` de nuevo.'); }
        if(codigoIngresado === guardado.code){ delete pendingCodes[remitente]; return await reply(`✅ *¡Conectado!* 🎉\nTu número +${remitente} quedó verificado.`); }
        return await reply('❌ Código incorrecto.');
      }
      if(texto === '.ping') return await reply('🏓 ¡Pong! Bot en línea.');
      if(texto === '.ayuda') return await reply('Comandos:\n.codigo - Muestra WhatsApp y te da código\n.verificar 123456 - Verifica tu código\n.ping - Revisa si estoy en línea');
    });
  }catch(e){ baileysError = e.message; console.error('Baileys no cargó aún:', e.message); }
}
startBot();
app.get('/', (req,res)=>res.send('Bot WhatsApp corriendo ✅'));
app.get('/status', (req,res)=>res.json({ready:isReady, qr: !!qrText, whatsapp_number: WHATSAPP_NUMBER, baileysError}));
app.get('/pairing', async (req,res)=>{
  try{
    if(isReady) return res.json({ok:false, ready:true, message:'Ya conectado, no necesitas codigo'});
    if(!sock) return res.json({ok:false, message:'Bot iniciando, espera 10 seg. Error: '+(baileysError||'sin error')});
    const numero = ((req.query.numero || WHATSAPP_NUMBER)+'').replace(/\D/g,'');
    const code = await sock.requestPairingCode(numero);
    res.json({ok:true, numero, codigo: code});
  }catch(e){ res.status(500).json({ok:false, error:e.message, message:'No se pudo generar codigo. Intenta de nuevo en 20 seg.'}); }
});
app.get('/qr', async (req,res)=>{
  try{
    if(isReady) return res.json({ready:true, message:'Ya conectado'});
    if(!qrText) return res.json({ready:false, message:'Generando QR...'});
    const qrcode = require('qrcode');
    const dataUrl = await qrcode.toDataURL(qrText);
    res.json({ready:false, qr: qrText, qrImage: dataUrl});
  }catch(e){ res.json({ready:false, message:e.message}); }
});
app.post('/send-codigo', async (req,res)=>{
  try{
    if(!isReady) return res.json({ok:false, message:'Bot aún no conectado'});
    const numero = (req.body.numero || WHATSAPP_NUMBER).replace(/\D/g,'');
    const codigo = generarCodigo();
    pendingCodes[numero] = {code: codigo, expires: Date.now()+5*60*1000};
    await sock.sendMessage(numero+'@s.whatsapp.net', {text:`📱 Bot WhatsApp\n\n🔐 Tu código de verificación es: *${codigo}*\nEscríbeme \`.verificar ${codigo}\` para conectar.\n⏰ Expira en 5 minutos.`});
    res.json({ok:true, numero, codigo});
  }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});
app.post('/verificar', (req,res)=>{
  const numero = (req.body.numero||'').replace(/\D/g,'');
  const codigo = String(req.body.codigo||'');
  const g = pendingCodes[numero];
  if(!g) return res.json({ok:false, message:'Sin código pendiente'});
  if(Date.now()>g.expires){ delete pendingCodes[numero]; return res.json({ok:false, message:'Código expirado'}); }
  if(codigo===g.code){ delete pendingCodes[numero]; return res.json({ok:true, message:'Verificado ✅'}); }
  res.json({ok:false, message:'Código incorrecto'});
});
app.listen(PORT, ()=>console.log(`🌐 Server en puerto ${PORT}`));
