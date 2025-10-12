# Bot Jailton - Assistente WhatsApp

## 🚀 Deploy no Render (Recomendado)

### Configuração no Dashboard
1. **Web Service**:
   - Conecte o repositório GitHub
   - Runtime: Node.js  
   - Build Command: `npm install && npx puppeteer browsers install chrome`
   - Start Command: `npm run start:render`
   - Plan: Free

2. **Variáveis de Ambiente** (obrigatórias):
   ```
   GOOGLE_CREDENTIALS={"type":"service_account",...} # JSON completo
   NODE_ENV=production
   RENDER=true
   PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
   PUPPETEER_CACHE_DIR=/tmp/.cache/puppeteer
   ```

3. **Disco Persistente**:
   - Name: `whatsapp-session`
   - Mount Path: `/opt/render/project/src/.wwebjs_auth`
   - Size: 1GB

### Primeiro Deploy
- Aguarde build completo (~2-3min)
- Acesse os logs para ver o QR Code em texto
- Escaneie com WhatsApp → Aparelhos Conectados
- A sessão será salva no disco persistente

## 🔧 Executar Localmente

```bash
npm install
npm start
```

## 🛠️ Troubleshooting

### Render
- **Chrome não encontrado**: Verifique build command
- **QR a cada deploy**: Configure disco persistente  
- **Não conecta Google Sheets**: Verifique `GOOGLE_CREDENTIALS`

### Local  
- **Múltiplos eventos ready**: Normal após reconexão
- **LOGOUT detectado**: Escaneie QR novamente no WhatsApp

## 📝 Funcionalidades
- ✅ Lembretes automáticos (6 meses após serviço)
- ✅ Agendamento via conversa
- ✅ Cadastro de clientes via vCard  
- ✅ Integração Google Sheets
- ✅ Reconexão automática

3. **Disco persistente**
   - Adicione um disco de 1GB.
   - Mount path: `/opt/render/project/src/.wwebjs_auth`

4. **Primeiro deploy**
   - O terminal mostrará o QR em texto. Gere o QR e escaneie no WhatsApp.
   - Após parear, a sessão será salva no disco.

5. **Configuração do WhatsApp Web.js**
   - O bot já está configurado para usar o Chromium do Puppeteer.
   - Flags de Puppeteer para ambiente cloud já estão no código.

## Troubleshooting
- **Erro "Failed to launch browser"**: Chrome baixado mas caminho incorreto - código agora auto-detecta.
- **Erro "Could not find Chrome"**: Verifique se o build command está como `npm run build`.
- **Se pedir QR a cada deploy**: revise o disco persistente.
- **Erro de AppState**: revise Puppeteer e disco.
- **Não conecta ao Google Sheets**: revise GOOGLE_CREDENTIALS.
- **Puppeteer fails**: Defina `PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer`.

### Debug do Puppeteer
Se ainda houver problemas, adicione estas variáveis temporariamente:
- `DEBUG`: puppeteer:*
- `PUPPETEER_EXECUTABLE_PATH`: /opt/render/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome (use a versão atual)

### Verificação manual do Chrome
Para verificar se o Chrome foi baixado, adicione temporariamente no código:
```bash
ls -la /opt/render/.cache/puppeteer/chrome/
```

## Segurança
- Nunca versionar `credentials.json` ou `.wwebjs_auth`.
- Use sempre variáveis de ambiente para credenciais.

---

Dúvidas? Veja os logs do Render ou peça suporte aqui!
