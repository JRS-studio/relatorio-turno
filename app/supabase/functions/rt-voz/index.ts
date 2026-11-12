// rt-voz: recebe o texto que o executante ditou e devolve as ocorrências já separadas em campos.
// Segurança: exige o código da equipe (validado no banco) e limita o uso diário por equipe.
// Segredo necessário: ANTHROPIC_API_KEY (Supabase > Edge Functions > Secrets). Sem ele, o app usa o
// interpretador local do próprio celular.
import Anthropic from "npm:@anthropic-ai/sdk";

const MODELO = Deno.env.get("RT_MODELO") ?? "claude-opus-5-5";
const LIMITE_DIA = Number(Deno.env.get("RT_LIMITE_DIA") ?? "400");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ocorrencias"],
  properties: {
    ocorrencias: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["esp", "area", "eq", "tipo", "falha", "acao", "hi", "hf", "parou", "tm", "sit", "obs", "quem"],
        properties: {
          esp: { type: "string", enum: ["ele", "mec"] },
          area: { type: "string" },
          eq: { type: "string" },
          tipo: { type: "string" },
          falha: { type: "string" },
          acao: { type: "string" },
          hi: { type: "string" },
          hf: { type: "string" },
          parou: { type: "string", enum: ["sim", "nao", ""] },
          tm: { type: "integer" },
          sit: { type: "string", enum: ["resolvido", "paliativo", "pendente", ""] },
          obs: { type: "string" },
          quem: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const SISTEMA = `Você organiza ocorrências de manutenção industrial (elétrica e mecânica) ditadas por voz por um técnico de turno, em português do Brasil. A transcrição vem do reconhecimento de voz do celular: pode ter erros de pontuação, números por extenso e palavras de preenchimento ("é", "aí", "tipo", "né").

Devolva uma entrada em "ocorrencias" para cada equipamento atendido. Normalmente é uma só; separe apenas quando o técnico claramente relatar atendimentos diferentes.

Campos:
- esp: "ele" (elétrica: motor elétrico, sensor, cabo, painel, inversor, CLP, contator, disjuntor, iluminação, fusível) ou "mec" (mecânica: rolamento, correia, rolo, redutor, acoplamento, vazamento, hidráulico, pneumático, solda, estrutura, lubrificação). Use o contexto; na dúvida, "ele".
- area: uma das áreas da lista, escrita exatamente como na lista. Se não foi dita, "".
- eq: equipamento ou TAG. Se combinar com um equipamento da lista de conhecidos (mesmo com outra grafia, ex.: "vt três" = "VT-03"), use a grafia da lista. TAGs em maiúsculas.
- tipo: um dos tipos de falha da lista da especialidade, exatamente como escrito lá, se der para inferir com segurança; senão "".
- falha: o que aconteceu (sintoma/defeito), frase curta e limpa, começando com maiúscula, sem palavras de preenchimento. Mantenha os termos técnicos que o técnico usou.
- acao: o que foi feito, frase curta e limpa. Pode juntar várias ações com vírgula.
- hi / hf: início da falha e fim do atendimento em "HH:MM" (24 h). Converta "duas e meia da tarde" = "14:30", "meio-dia" = "12:00". Horários relativos usam a hora atual informada: "agora", "acabei agora" = hora atual; "faz meia hora" = hora atual menos 30 min. Se o técnico disser só a duração ("levei 40 minutos") e um dos horários, calcule o outro. Se não der para saber, "".
- parou: "sim" se o equipamento ficou parado por causa da falha, "nao" se disse que não parou, "" se não falou.
- tm: minutos de equipamento parado. Se parou e não disse por quanto tempo, mas disse início e fim, use a duração. Desconhecido ou não parou: 0.
- sit: "resolvido" (resolvido, normalizado, liberado, funcionando), "paliativo" (provisório, gambiarra, paliativo, precisa trocar depois), "pendente" (não terminou, aguardando peça, ficou para o próximo turno). Se não falou, "".
- obs: o que falta fazer ou recomendação para o próximo turno/preventiva, quando houver; senão "".
- quem: nomes de colegas citados como quem atendeu, usando a grafia da lista da equipe. Se ninguém foi citado, lista vazia.

Nunca invente informação que não foi dita nem pode ser deduzida com segurança: deixe vazio.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ erro: "metodo" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ erro: "json-invalido" }, 400); }
  const codigo = String(body?.codigo ?? "").slice(0, 20);
  const texto = String(body?.texto ?? "").trim().slice(0, 4000);
  const ctx = body?.ctx ?? {};
  if (!codigo || texto.length < 3) return json({ erro: "dados-incompletos" }, 400);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ erro: "sem-chave" }, 503);

  // valida o código da equipe e conta o uso (função só acessível com a service role)
  const url = Deno.env.get("SUPABASE_URL")!;
  const srv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const r = await fetch(`${url}/rest/v1/rpc/rt_registrar_voz`, {
    method: "POST",
    headers: { apikey: srv, Authorization: `Bearer ${srv}`, "Content-Type": "application/json" },
    body: JSON.stringify({ codigo, limite: LIMITE_DIA }),
  });
  if (!r.ok) {
    const m = await r.text();
    if (m.includes("codigo-invalido")) return json({ erro: "codigo-invalido" }, 403);
    if (m.includes("limite-diario")) return json({ erro: "limite-diario" }, 429);
    return json({ erro: "banco" }, 502);
  }

  const lista = (v: unknown, max: number) => (Array.isArray(v) ? v : []).map((x) => String(x).slice(0, 60)).slice(0, max);
  const contexto = [
    `Hora atual: ${String(ctx.agora ?? "").slice(0, 5) || "desconhecida"}`,
    `Áreas: ${lista(ctx.areas, 40).join(" | ") || "(nenhuma)"}`,
    `Tipos de falha elétrica: ${lista(ctx.tiposEle, 40).join(" | ") || "(nenhum)"}`,
    `Tipos de falha mecânica: ${lista(ctx.tiposMec, 40).join(" | ") || "(nenhum)"}`,
    `Equipe do turno: ${lista(ctx.equipe, 20).join(" | ") || "(não informada)"}`,
    `Equipamentos já registrados: ${lista(ctx.equipamentos, 300).join(" | ") || "(nenhum)"}`,
  ].join("\n");

  const client = new Anthropic({ apiKey });
  try {
    const resp = await client.messages.create({
      model: MODELO,
      max_tokens: 4000,
      system: SISTEMA,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: `${contexto}\n\nTranscrição do técnico:\n"""${texto}"""` }],
    } as any);
    if (resp.stop_reason === "refusal") return json({ erro: "recusado" }, 422);
    const bloco = resp.content.find((b: any) => b.type === "text") as any;
    const dados = JSON.parse(bloco?.text ?? "{}");
    return json({ ok: true, ocorrencias: dados.ocorrencias ?? [], modelo: resp.model });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ erro: "ocupado" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ erro: "chave-invalida" }, 503);
    if (e instanceof Anthropic.APIError) return json({ erro: "ia", status: e.status }, 502);
    return json({ erro: "falha" }, 500);
  }
});
