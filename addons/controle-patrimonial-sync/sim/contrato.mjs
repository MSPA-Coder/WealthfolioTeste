// Valida respostas do contrato patrimonio/v4 contra o JSON Schema.
//
// `sim/contrato/patrimonio-v4.schema.json` é uma cópia da canônica em
// manutencao/docs/contratos/; as do CB e do CRV (tests/contrato/) são idênticas.
// Para mudar o contrato, mude a canônica e copie para todos na mesma mudança.
//
// As mensagens só trazem o caminho do campo e a regra violada, nunca o valor:
// no modo real (SIM_REAL=1) as respostas de produção passam por aqui, e o
// relatório não pode vazar dado.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const aqui = dirname(fileURLToPath(import.meta.url));
export const schema = JSON.parse(readFileSync(join(aqui, 'contrato', 'patrimonio-v4.schema.json'), 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
ajv.addSchema(schema);

export function validar(nome, instancia) {
  const validador = ajv.getSchema(`${schema.$id}#/$defs/${nome}`);
  if (!validador) throw new Error(`schema sem a definição ${nome}`);
  const ok = validador(instancia);
  const erros = ok
    ? []
    : [...new Set(validador.errors.map((e) => `${e.instancePath || '(raiz)'}: ${e.message}`))].slice(0, 6);
  return { ok, erros };
}
