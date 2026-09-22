# Библиотека

```ts
import { Gateway } from '@rizias/tt-testops';

const gateway = Gateway.fromEnv();
const markdown = await gateway.getTestCase('<ид-кейса>');
```

| Метод | Результат |
|---|---|
| `getTestCase(id)` | Markdown либо `null` |
| `getTestCaseJson(id)` | кейс и пометки структурой |
| `getTestCaseHtml(id)` | самодостаточная страница |
| `getTestCaseRaw(id)` | сырой ответ TestOps |
| `getTestCasesList(sources, limit)` | выборка как Markdown |
| `searchCasesJson(sources, limit)` | выборка и пометки структурой |

Сеть и хранилище — внутри `Gateway`. `normalizeCase`, `renderCase`, `toJson`, `auditCase` экспортируются
отдельно для кода, который уже получил данные.
