# Bot Jailton - Deploy no Render

## Requisitos
- Node.js 18+
- Variável de ambiente GOOGLE_CREDENTIALS (JSON da service account Google)
- Disco persistente montado em `/opt/render/project/src/.wwebjs_auth` (Render)
- Puppeteer instalado (já no package.json)

## Passos para Deploy no Render

1. **Crie o serviço Web**
   - Conecte o repositório.
   - Build command: `npm run build`
   - Start command: `npm start`

2. **Variáveis de ambiente**
   - `GOOGLE_CREDENTIALS`: cole o JSON completo da service account.
   - `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD`: false
   - `PUPPETEER_CACHE_DIR`: /opt/render/.cache/puppeteer
   - `PUPPETEER_EXECUTABLE_PATH`: (opcional, auto-detectado)
   - `PORT`: Render define automaticamente.

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
- `PUPPETEER_EXECUTABLE_PATH`: /opt/render/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome

## Segurança
- Nunca versionar `credentials.json` ou `.wwebjs_auth`.
- Use sempre variáveis de ambiente para credenciais.

---

Dúvidas? Veja os logs do Render ou peça suporte aqui!
