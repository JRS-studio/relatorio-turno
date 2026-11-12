# Relatório de Turno (app Android)

App para a equipe de manutenção (elétrica e mecânica) lançar as ocorrências do turno e gerar o
relatório pronto para enviar no grupo do WhatsApp. **Os executantes do turno lançam do próprio
celular no mesmo relatório**; o último a encerrar gera o texto e envia no grupo. Feito para ser
rápido no chão de fábrica e **sem nenhum vínculo com a empresa**: o servidor é um projeto
Supabase seu, não há login nem cadastro, e não existe nome de planta ou equipamento gravado no
código. Tudo que é específico (áreas, turnos, equipe, tipos de falha, título do relatório) o
próprio usuário configura em *Ajustes*.

## Como a equipe trabalha junta

1. Uma pessoa cria a equipe no app e recebe um **código** (ex.: `KA8J-5J2K`). Passa aos colegas.
2. Cada colega entra com o código e o próprio nome. Pronto: todos veem o mesmo turno.
3. Quem chega primeiro abre o turno; os outros entram nele automaticamente (o servidor impede
   dois turnos abertos ao mesmo tempo).
4. Cada um lança suas ocorrências. Sem sinal, fica guardado no celular e sobe quando voltar.
5. Ao terminar, cada um toca em **Meus lançamentos estão completos**. Quem vai encerrar vê quem
   já confirmou.
6. O último encerra: o app busca os lançamentos de todos, gera o texto e abre o WhatsApp.

## O que o app faz

- **Iniciar turno**: data, turno (sugerido pelo horário), letra e quem está presente.
- **Rascunho rápido**: digita só o equipamento e o app marca a hora de início. Completa depois.
- **Ocorrência completa**: especialidade, área, equipamento (com sugestão dos já usados),
  tipo de falha, o que aconteceu, o que foi feito, início/fim com botão *Agora*, equipamento
  parou e por quanto tempo, situação final (resolvido, paliativo, pendente), quem atendeu.
- **Histórico por equipamento**: ao digitar o equipamento, mostra os últimos atendimentos e
  permite reaproveitar a ação anterior.
- **Pendências estruturadas**: o que ficou pendente ou paliativo vira pendência; o próximo turno
  recebe a lista e só marca o que concluiu.
- **Encerramento com conferência**: avisa rascunhos, tempo parado maior que o atendimento,
  atendimento sem nome, e pede confirmação da equipe.
- **Relatório**: texto formatado para WhatsApp (negrito, seções, totais). Botão *Enviar no
  WhatsApp* abre a lista de conversas para escolher o grupo; também dá para copiar.
- **Histórico de turnos**, reabrir para corrigir, reenviar.
- **Backup** manual (exportar/importar texto) e **apagar tudo**.

## Segurança da informação

- O servidor é um projeto **Supabase** criado por você (plano gratuito basta), em São Paulo.
  Nada passa por terceiros além dele.
- As tabelas têm RLS ligado **sem nenhuma política**: a chave pública que vai no app não lê nem
  grava nada diretamente. Todo acesso passa por funções `rt_*` que exigem o **código da equipe**,
  guardado no servidor apenas como hash SHA-256 (`supabase/schema.sql`).
- Sem login, sem e-mail, sem rastreamento. A única identificação é o nome que a pessoa digita.
- Sem backup automático em nuvem do Android (`allowBackup=false`). A única permissão é INTERNET.
- Nenhum nome de empresa, planta, área ou equipamento no código. Os padrões são genéricos
  ("Área 1", turnos A/B/C) e editáveis. Os dados pertencem à equipe, no projeto Supabase seu.
- Quem tem o código da equipe vê e lança no relatório: trate-o como uma senha do grupo. Se
  vazar, crie uma equipe nova (o código antigo pode ser removido no SQL Editor apagando a linha
  em `rt_equipes`).

## Configurar o servidor (uma vez, 5 minutos)

1. Crie uma conta em https://supabase.com e um projeto (região **South America (São Paulo)**,
   plano Free). Guarde a senha do banco em lugar seguro; o app não usa essa senha.
2. No painel do projeto, abra **SQL Editor**, cole o conteúdo de `supabase/schema.sql` e execute.
3. Em **Project Settings > API** copie a **Project URL** e a chave **publishable** (ou a
   **anon** antiga).
4. Cole as duas em `www/config.js`. Assim todos os celulares já vêm configurados. (Também dá
   para informar no app, em *Ajustes > Servidor*, celular por celular.)
5. Gere o app (abaixo), instale, crie a equipe e distribua o código.

Sem servidor configurado o app continua funcionando em modo individual, só no aparelho.

## Estrutura

```
app/
  www/                 interface (HTML, CSS, JS puros, sem dependências)
  www/config.js        URL e chave pública do servidor da equipe
  supabase/schema.sql  tabelas e funções do servidor (colar no SQL Editor do Supabase)
  android/             projeto Android gerado pelo Capacitor (abre no Android Studio)
  capacitor.config.json
  loja/                ícone 512 px e textos para a ficha da Play Store
  politica-privacidade.html
```

## Como testar no navegador

```bash
cd app/www
python3 -m http.server 8080     # ou qualquer servidor estático
# abra http://localhost:8080 no Chrome em modo celular (F12 > ícone de dispositivo)
```

No navegador o botão *Enviar no WhatsApp* usa o link `wa.me`; no app Android usa a folha de
compartilhamento nativa. Para testar a sincronização sem Supabase, há um simulador do servidor
sobre um PostgreSQL local em `supabase/mock-postgrest.js` (ver comentário no arquivo).

## Como gerar o app (AAB) para a Play Store

Requisitos no seu computador: [Android Studio](https://developer.android.com/studio) recente
(com JDK 21 embutido) e Node 20+.

1. Instalar dependências e sincronizar a interface para dentro do projeto Android:
   ```bash
   cd app
   npm install
   npx cap sync android
   ```
2. Abrir o projeto: `npx cap open android` (ou abra a pasta `app/android` no Android Studio).
   Na primeira vez o Android Studio baixa o SDK 36 e as bibliotecas; aguarde o Gradle terminar.
3. Testar num celular: conecte pelo USB com depuração ativada e clique em **Run** (▶).
4. Gerar o pacote assinado: **Build > Generate Signed App Bundle / APK > Android App Bundle**.
   - Na primeira vez, **Create new** para criar a chave (`.jks`). Guarde o arquivo e as senhas
     em lugar seguro: sem eles não dá para atualizar o app depois. A chave **não** deve ir para
     o Git (já está no `.gitignore`).
   - Escolha *release*. O arquivo sai em `app/android/app/release/app-release.aab`.
5. A cada nova versão, aumente `versionCode` (inteiro) e `versionName` em
   `app/android/app/build.gradle` antes de gerar o AAB.

### Publicar no Google Play Console

1. Crie a conta de desenvolvedor em https://play.google.com/console (taxa única).
2. **Criar app** > nome "Relatório de Turno", idioma português (Brasil), app gratuito.
3. Preencha a ficha da loja com os textos de `loja/descricao.md`, o ícone `loja/icone-512.png`
   e pelo menos 2 capturas de tela do celular (tire direto no aparelho).
4. **Política de privacidade**: publique `politica-privacidade.html` em qualquer endereço
   público (por exemplo o GitHub Pages deste repositório) e informe o link.
5. **Segurança dos dados**: o app envia ao seu servidor o nome digitado e os textos das
   ocorrências; as respostas sugeridas estão em `loja/descricao.md`.
6. **Classificação de conteúdo**: questionário padrão, app utilitário, sem conteúdo sensível.
7. **Público-alvo**: 18+ (ferramenta de trabalho).
8. Envie o `.aab` em *Teste interno* primeiro, instale pelo link de teste, confira o envio para
   o WhatsApp e depois promova para *Produção*.

Contas novas no Play Console precisam de um período de teste fechado com pelo menos 12
testadores antes de liberar para produção. Use a própria equipe do turno como testadores.

## Distribuir sem a Play Store

Para usar só com a equipe, dá para gerar um APK (**Build > Generate Signed App Bundle / APK >
APK**) e instalar direto nos celulares. Funciona igual, sem passar pela loja.
