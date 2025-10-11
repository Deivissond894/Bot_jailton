// ==============================================================================
// SEÇÃO 1: DEPENDÊNCIAS E CONFIGURAÇÕES
// ==============================================================================
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const cron = require('node-cron');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const express = require('express'); // 🚀 servidor para Render
const fs = require('fs');
const path = require('path');

// Configurar Puppeteer para usar o Chrome baixado
function findChromePath() {
  const possiblePaths = [
    // Caminho padrão do Puppeteer no Render
    '/opt/render/.cache/puppeteer/chrome',
    // Caminho local se existir
    path.join(__dirname, 'node_modules', 'puppeteer', '.local-chromium'),
    // Caminhos do sistema
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];

  // Procura por diretórios chrome no cache do Puppeteer
  try {
    const puppeteerCacheDir = '/opt/render/.cache/puppeteer/chrome';
    if (fs.existsSync(puppeteerCacheDir)) {
      const versions = fs.readdirSync(puppeteerCacheDir);
      if (versions.length > 0) {
        const latestVersion = versions.sort().pop();
        const chromePath = path.join(puppeteerCacheDir, latestVersion, 'chrome-linux64', 'chrome');
        if (fs.existsSync(chromePath)) {
          console.log(`Chrome encontrado em: ${chromePath}`);
          return chromePath;
        }
      }
    }
  } catch (err) {
    console.warn('Erro ao procurar Chrome no cache:', err.message);
  }

  // Tenta usar o executablePath do puppeteer
  try {
    const puppeteer = require('puppeteer');
    const execPath = puppeteer.executablePath();
    if (fs.existsSync(execPath)) {
      console.log(`Chrome do Puppeteer encontrado: ${execPath}`);
      return execPath;
    }
  } catch (err) {
    console.warn('Puppeteer executablePath falhou:', err.message);
  }

  // Verifica caminhos do sistema
  for (const chromePath of possiblePaths) {
    if (fs.existsSync(chromePath)) {
      console.log(`Chrome do sistema encontrado: ${chromePath}`);
      return chromePath;
    }
  }

  console.error('Nenhum executável do Chrome encontrado!');
  return null;
}

const puppeteerExecutablePath = findChromePath();

// carrega as credenciais da env ou faz fallback para o arquivo credentials.json
let credentials;
(() => {
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (raw && raw.trim()) {
    try {
      credentials = JSON.parse(raw);
      return;
    } catch (e) {
      console.error('Erro ao analisar GOOGLE_CREDENTIALS. Verifique se é um JSON válido.');
      console.error(e.message);
      process.exit(1);
    }
  }

  // Fallback para arquivo local
  const credPath = path.resolve(__dirname, 'credentials.json');
  if (fs.existsSync(credPath)) {
    try {
      const fileContent = fs.readFileSync(credPath, 'utf8');
      credentials = JSON.parse(fileContent);
      return;
    } catch (e) {
      console.error('Não foi possível ler/parsear o arquivo credentials.json.');
      console.error(e.message);
      process.exit(1);
    }
  }

  console.error('Credenciais do Google não encontradas. Defina GOOGLE_CREDENTIALS (JSON) ou adicione credentials.json na raiz do projeto.');
  process.exit(1);
})();

// ID da planilha
const idDaPlanilha = '1e9HEEsBHelQsAJynGldKxE8POO5xQXYtoOWyYt2gnGU';
const numerosAutorizados = ['557191994913@c.us', '557197232017@c.us'];

const conversasEmAndamento = new Map();
const doc = new GoogleSpreadsheet(idDaPlanilha);

let planilhaCarregada = false;
let cronJobAgendado = null;
let isInitializing = false;

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

function normalizaTelefoneParaJid(valor) {
  if (!valor) return null;
  // Se já vier como JID
  if (typeof valor === 'string' && valor.endsWith('@c.us')) return valor;
  // Extrai apenas dígitos
  const digits = String(valor).replace(/\D/g, '');
  if (!digits) return null;
  // Garante código do país BR (55)
  const comPais = digits.startsWith('55') ? digits : `55${digits}`;
  // Tamanho mínimo razoável (55 + DDD 2 + número 8/9)
  if (comPais.length < 12) return null;
  return `${comPais}@c.us`;
}

async function enviarMensagemSegura(jidOuTelefone, texto) {
  try {
    const state = await client.getState().catch(() => null);
    if (state !== 'CONNECTED') {
      console.warn(`${timestampBR()} Cliente não está conectado (state=${state}). Mensagem não enviada.`);
      return false;
    }
    const jid = normalizaTelefoneParaJid(jidOuTelefone);
    if (!jid) {
      console.warn(`Número/JID inválido: ${jidOuTelefone}`);
      return false;
    }
    const isUser = await client.isRegisteredUser(jid).catch(() => false);
    if (!isUser) {
      console.warn(`Destino não está registrado no WhatsApp: ${jid}`);
      return false;
    }
    await client.sendMessage(jid, texto);
    return true;
  } catch (e) {
    console.error(`Falha ao enviar mensagem para ${jidOuTelefone}:`, e.message);
    return false;
  }
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

  await enviarMensagemSegura(row['Telefone'], mensagemLembrete);

        row['Lembrete Enviado'] = 'SIM';
        await row.save();

  conversasEmAndamento.set(normalizaTelefoneParaJid(row['Telefone']), { passo: 1 });
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
      await enviarMensagemSegura(numero, statusMsg);
    }
  } catch (err) {
    console.error("Erro na verificação de lembretes:", err.message);
  }
}

// ==============================================================================
// SEÇÃO 4: CONFIGURAÇÃO E EVENTOS DO WHATSAPP
// ==============================================================================
// Verificar se encontrou o Chrome
if (!puppeteerExecutablePath && !process.env.PUPPETEER_EXECUTABLE_PATH) {
  console.error('ERRO CRÍTICO: Chrome não encontrado! Verifique se o Puppeteer foi instalado corretamente.');
  process.exit(1);
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.resolve(__dirname, '.wwebjs_auth') }),
  restartOnAuthFail: true,
  takeoverOnConflict: true,
  takeoverTimeoutMs: 10_000,
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteerExecutablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ],
    defaultViewport: null
  }
});

console.log(`Usando Chrome em: ${process.env.PUPPETEER_EXECUTABLE_PATH || puppeteerExecutablePath}`);

client.on('qr', qr => {
  console.log("====== COPIE ESSE TEXTO DO QR CODE ======");
  console.log(qr);
  console.log("Cole em um conversor online de QR para gerar a imagem.");
});

client.on('ready', async () => {
  console.log('Assistente está pronta!');
  
  try {
    // 🔥 Ajuste para funcionar com google-spreadsheet atual
    await doc.useServiceAccountAuth({
      client_email: credentials.client_email,
      private_key: credentials.private_key.replace(/\\n/g, '\n'),
    });

    await doc.loadInfo();
    planilhaCarregada = true;
    console.log(`✅ Conectado à planilha: ${doc.title}`);
    await verificarEEnviarLembretes();
  } catch (err) {
    console.error("❌ Erro ao conectar à planilha:", err.message);
    return;
  }

  // Agendamento automático diário (meia-noite)
  if (!cronJobAgendado) {
    cronJobAgendado = cron.schedule('0 0 * * *', verificarEEnviarLembretes);
    console.log('Agendamento automático de verificação (1x por dia) ativado.');
  } else {
    console.log('Agendamento já estava ativo. Evitando múltiplos cron jobs.');
  }
});

client.on('auth_failure', (msg) => {
  console.error('Falha na autenticação:', msg);
});

client.on('disconnected', (reason) => {
  console.error('Cliente desconectado:', reason);
  // tenta reinicializar com proteção contra múltiplas inicializações
  if (!isInitializing) {
    isInitializing = true;
    setTimeout(() => {
      client.initialize().finally(() => {
        isInitializing = false;
      });
    }, 3000);
  }
});

client.on('change_state', (state) => {
  console.log('Estado do cliente mudou para:', state);
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
        await enviarMensagemSegura(numero, `Cliente com dúvida: ${message.from} → ${message.body}`);
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
          await enviarMensagemSegura(
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

client.initialize();

// ==============================================================================
// SEÇÃO EXTRA: SERVIDOR EXPRESS PARA O RENDER
// ==============================================================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('🚀 Bot rodando com sucesso no Render!'));

app.listen(PORT, () => {
  console.log(`Servidor Express ativo na porta ${PORT}`);
});
