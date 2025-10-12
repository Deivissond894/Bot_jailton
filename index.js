// ==============================================================================
// SEÇÃO 1: DEPENDÊNCIAS E CONFIGURAÇÕES
// ==============================================================================
const qrcode = require('qrcode-terminal');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const cron = require('node-cron');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const express = require('express');

// Carregar credenciais (env primeiro, fallback para arquivo)
let credentials;
if (process.env.GOOGLE_CREDENTIALS) {
  try {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  } catch (e) {
    console.error('Erro ao parsear GOOGLE_CREDENTIALS:', e.message);
    process.exit(1);
  }
} else {
  try {
    credentials = require('./credentials.json');
  } catch (e) {
    console.error('Arquivo credentials.json não encontrado e GOOGLE_CREDENTIALS não definido');
    process.exit(1);
  }
}

const idDaPlanilha = '1e9HEEsBHelQsAJynGldKxE8POO5xQXYtoOWyYt2gnGU';
const numerosAutorizados = ['557191994913@c.us', '557197232017@c.us'];

const conversasEmAndamento = new Map();
const doc = new GoogleSpreadsheet(idDaPlanilha);

let planilhaCarregada = false;
let clientePronto = false; // evita executar lógica de ready múltiplas vezes
let inicializando = false; // trava para reinitialize
let tarefaCron = null; // referência do agendamento para não duplicar

// ==============================================================================
// SEÇÃO 2: FUNÇÕES AUXILIARES
// ==============================================================================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDate(dateString) {
  const [day, month, year] = dateString.split('/').map(Number);
  return new Date(year, month - 1, day);
}

function saudacaoPorHorario() {
  const hora = new Date().getHours();
  if (hora < 12) return "Oi, bom dia, como vai?";
  if (hora < 18) return "Oi, boa tarde, como vai?";
  return "Oi, boa noite, como vai?";
}

function timestampBR() {
  const d = new Date();
  const date = d.toLocaleDateString('pt-BR');
  const time = d.toLocaleTimeString('pt-BR', { hour12: false });
  return `[${date}, ${time}]`;
}

// ==============================================================================
// SEÇÃO 3: LÓGICA DO BOT E AGENDAMENTOS
// ==============================================================================
async function verificarEEnviarLembretes() {
  console.log('Iniciando verificação de lembretes...');

  if (!planilhaCarregada) return;

  try {
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();

    const dataAtual = new Date();
    let lembretesEnviados = 0;

    for (const row of rows) {
      const dataServico = parseDate(row['Data do Servico']);
      const data6MesesDepois = new Date(dataServico.setMonth(dataServico.getMonth() + 6));

      if (
        dataAtual >= data6MesesDepois &&
        !row['Data do Agendamento'] &&
        row['Lembrete Enviado'] !== 'SIM'
      ) {
        const mensagemLembrete = saudacaoPorHorario();

        await client.sendMessage(row['Telefone'] + '@c.us', mensagemLembrete);

        row['Lembrete Enviado'] = 'SIM';
        await row.save();

        conversasEmAndamento.set(row['Telefone'] + '@c.us', { passo: 1 });
        lembretesEnviados++;
        await sleep(60000); // pausa de 1 min entre lembretes
      }
    }

    const statusMsg =
      lembretesEnviados > 0
        ? `${timestampBR()} Verificação concluída. ${lembretesEnviados} lembrete(s) enviado(s).`
        : `${timestampBR()} Verificação concluída. Nenhum lembrete pendente.`;

    console.log(statusMsg);

    for (const numero of numerosAutorizados) {
      await client.sendMessage(numero, statusMsg);
    }
  } catch (_) {}
}

// ==============================================================================
// SEÇÃO 4: CONFIGURAÇÃO E EVENTOS DO WHATSAPP
// ==============================================================================
// Auth separado para permitir override seguro do logout (tolerante a EBUSY no Windows)
const auth = new LocalAuth({
  clientId: 'jailton-assistant',
  dataPath: path.resolve(__dirname, '.wwebjs_auth'),
  rmMaxRetries: 50
});

// Evita crash quando o Windows mantém locks de arquivos (EBUSY)
const originalLogout = auth.logout.bind(auth);
auth.logout = async function () {
  try {
    await originalLogout();
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes('EBUSY') || msg.includes('resource busy or locked')) {
      console.warn('Aviso: EBUSY ao remover sessão. Ignorando e seguindo adiante.');
      return; // suprime o erro para não derrubar o processo
    }
    throw e;
  }
};

const client = new Client({
  authStrategy: auth,
  restartOnAuthFail: true,
  takeoverOnConflict: true,
  takeoverTimeoutMs: 15000,
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ],
    timeout: 60000
  }
});

console.log('Inicializando cliente WhatsApp...');

client.on('qr', (qr) => {
  console.log('====== COPIE ESTE CÓDIGO DO QR ======');
  console.log(qr);
  console.log('Cole em um gerador de QR Code online e escaneie com seu WhatsApp');
  console.log('=====================================');
});

client.on('authenticated', () => {
  console.log('WhatsApp autenticado com sucesso!');
});

client.on('auth_failure', (msg) => {
  console.error('Falha na autenticação:', msg);
});

client.on('disconnected', (reason) => {
  console.log('WhatsApp desconectado. Motivo:', reason);
  clientePronto = false;
  planilhaCarregada = false; // força reconexão da planilha também

  // Não reconectar automaticamente no LOGOUT (usuário saiu intencionalmente)
  if (reason === 'LOGOUT') {
    console.log('Logout detectado. Não tentando reconectar automaticamente.');
    return;
  }

  // Reconectar para outros tipos de desconexão
  if (!inicializando) {
    inicializando = true;
    const delayMs = 3000; // 3s para estabilizar
    console.log(`Tentando reconectar em ${delayMs / 1000}s...`);
    setTimeout(async () => {
      try {
        console.log('🔄 Reinicializando cliente WhatsApp...');
        await client.destroy();
        await sleep(2000);
        await client.initialize();
      } catch (err) {
        console.error('Erro ao reconectar:', err?.message || err);
      } finally {
        inicializando = false;
      }
    }, delayMs);
  }
});

client.on('error', (err) => {
  console.error('Erro do cliente WhatsApp:', err?.message || err);
});

client.on('loading_screen', (percent, message) => {
  console.log('Carregando...', percent, message);
});

client.on('ready', async () => {
  console.log('✅ WhatsApp conectado! Assistente está pronta!');

  if (clientePronto) {
    console.log('Evento ready duplicado detectado; ignorando configuração repetida.');
    return;
  }
  clientePronto = true;

  try {
    console.log('Conectando à planilha Google...');
    await doc.useServiceAccountAuth(credentials);
    await doc.loadInfo();
    planilhaCarregada = true;
    console.log(`✅ Planilha "${doc.title}" conectada com sucesso!`);
    
    await verificarEEnviarLembretes();
  } catch (error) {
    console.error('❌ Erro ao conectar planilha:', error.message);
    return;
  }

  // Agendamento automático diário (meia-noite)
  if (!tarefaCron) {
    tarefaCron = cron.schedule('0 0 * * *', verificarEEnviarLembretes);
    console.log('Agendamento automático de verificação (1x por dia) ativado.');
  }
});

// ==============================================================================
// SEÇÃO 5: RECEBIMENTO DE MENSAGENS
// ==============================================================================
client.on('message', async message => {
  if (!planilhaCarregada) {
    message.reply('Ainda estou carregando. Por favor, aguarde alguns segundos e tente novamente.');
    return;
  }

  // Cadastro via VCARD (apenas autorizados)
  if (message.type === 'vcard' && numerosAutorizados.includes(message.from)) {
    try {
      const nomeMatch = message.body.match(/FN:(.+)/);
      const nome = nomeMatch ? nomeMatch[1].trim() : 'Sem Nome';

      const telMatch = message.body.match(/waid=(\d+)/);
      const telefone = telMatch ? telMatch[1].trim() : '';

      const dataServico = new Date().toLocaleDateString('pt-BR');

      const sheet = doc.sheetsByIndex[0];
      await sheet.addRow({
        'Nome do Cliente': nome,
        'Telefone': telefone,
        'Data do Servico': dataServico,
        'Data do Agendamento': '',
        'Lembrete Enviado': ''
      });

      message.reply(`Cliente ${nome} (${telefone}) registrado com sucesso em ${dataServico}.`);
    } catch (_) {
      message.reply('Erro ao registrar o cliente. Verifique os dados.');
    }
    return;
  }

  // Comandos só para autorizados
  if (numerosAutorizados.includes(message.from)) {
    if (message.body === 'VERIFICAR_LEMBRETES') {
      await message.reply('Iniciando verificação manual de lembretes. Avisarei ao concluir.');
      await verificarEEnviarLembretes();
    }
    return;
  }

  // Fluxo de clientes
  if (!conversasEmAndamento.has(message.from)) return;

  const estadoConversa = conversasEmAndamento.get(message.from);

  if (estadoConversa.passo === 1) {
    await message.reply(
      "Sou Vitória, Assistente da Santos Refrigear. Percebemos que sua última manutenção foi há 6 meses. Vamos agendar a sua *Higienização*."
    );
    await message.reply(
      "👉 Responda com uma das opções:\n1️⃣ Sim, quero agendar\n2️⃣ Ainda não preciso\n3️⃣ Tenho dúvidas"
    );
    conversasEmAndamento.set(message.from, { passo: 2 });
    return;
  }

  if (estadoConversa.passo === 2) {
    const resposta = message.body.toLowerCase();

    if (["1", "sim", "quero", "agendar"].some(opt => resposta.includes(opt))) {
      await message.reply("Perfeito 🙌 Quantas máquinas serão higienizadas?");
      conversasEmAndamento.set(message.from, { passo: 3 });
      return;
    }

    if (["2", "não", "nao", "ainda não", "agora não", "depois"].some(opt => resposta.includes(opt))) {
      await message.reply("Tudo bem 👍 Vamos te lembrar novamente mais pra frente.");
      conversasEmAndamento.delete(message.from);
      return;
    }

    if (["3", "dúvida", "duvida", "valor", "quanto", "preço", "preco"].some(opt => resposta.includes(opt))) {
      await message.reply("Certo 😉 Vou encaminhar sua dúvida para nossa equipe.");
      for (const numero of numerosAutorizados) {
        await client.sendMessage(numero, `Cliente com dúvida: ${message.from} → ${message.body}`);
      }
      conversasEmAndamento.delete(message.from);
      return;
    }
  }

  if (estadoConversa.passo === 3) {
    const numMaquinas = message.body;
    await message.reply("Perfeito! Para confirmar seu agendamento, me diga a data ideal. Ex: 11/09");
    conversasEmAndamento.set(message.from, { passo: 4, numMaquinas });
    return;
  }

  if (estadoConversa.passo === 4 && message.body.match(/^\d{2}\/\d{2}$/)) {
    const dataAgendamento = message.body;
    const numMaquinas = estadoConversa.numMaquinas;

    try {
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();
      const clienteRow = rows.find(row => row['Telefone'] + '@c.us' === message.from);

      if (clienteRow) {
        clienteRow['Data do Agendamento'] = dataAgendamento;
        await clienteRow.save();

        const link = `https://wa.me/557197232017?text=Olá,%20gostaria%20de%20agendar%20uma%20higienização%20para%20dia%20${encodeURIComponent(
          dataAgendamento
        )}%20no%20horário%20comercial!`;

        await message.reply(
          `Tudo pronto! Agora clique abaixo para confirmar seu agendamento com nosso setor de serviço:\n\n${link}`
        );

        for (const numero of numerosAutorizados) {
          await client.sendMessage(
            numero,
            `Agendamento marcado!\nCliente: ${clienteRow['Nome do Cliente']}\nData: ${dataAgendamento}\nMáquinas: ${numMaquinas}`
          );
        }
      }
    } catch (_) {}

    conversasEmAndamento.delete(message.from);
    return;
  }
});

// ==============================================================================
// SEÇÃO 6: SERVIDOR EXPRESS (RENDER)
// ==============================================================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  const status = clientePronto ? '✅ Conectado' : '⏳ Conectando...';
  res.json({
    status: 'Bot Jailton rodando',
    whatsapp: status,
    planilha: planilhaCarregada ? '✅ Conectada' : '⏳ Conectando...',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    healthy: clientePronto && planilhaCarregada,
    uptime: process.uptime()
  });
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor rodando na porta ${PORT}`);
});

// Inicializar o cliente
console.log('🚀 Iniciando cliente WhatsApp...');
client.initialize().catch(error => {
  console.error('❌ Erro ao inicializar cliente:', error);
});

// Adicionar tratamento para erros não capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejeitada não tratada:', reason);
});

// Encerramento gracioso para evitar arquivos de sessão bloqueados (Windows)
const finalizar = async (codigo = 0) => {
  try {
    if (tarefaCron) {
      try { tarefaCron.stop(); } catch (_) {}
    }
    await client.destroy();
  } catch (_) {}
  try { process.exit(codigo); } catch (_) {}
};

process.on('SIGINT', () => finalizar(0));
process.on('SIGTERM', () => finalizar(0));
