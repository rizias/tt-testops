import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface SetupAdvice {
  project: string;
  isNpmProject: boolean;
  lines: string[];
}

export function setupAdvice(projectDir: string, toolDir: string, version: string): SetupAdvice {
  const project = resolve(projectDir);
  const isNpmProject = existsSync(join(project, 'package.json'));
  const lines: string[] = [
    `Проект: ${project}`,
    `Версия инструмента: ${version}`,
    '',
    'Саму команду можно поставить на машину — тогда она доступна из любого каталога:',
    '',
    `  npm i -g ${toolDir}`,
    '',
    'Скилл ставится отдельно и только в проект: глобального скилла нет, он мешал бы в остальных',
    'проектах. Подключение к этому проекту:',
    '',
  ];

  if (isNpmProject) {
    lines.push(
      'Это npm-проект — подключи инструмент зависимостью прямо из его папки:',
      '',
      `  npm i -D file:${toolDir}`,
      '  npx tt-testops init',
      '',
      'После этого агент в этом проекте зовёт инструмент как `npx tt-testops <команда>`.',
    );
  } else {
    lines.push(
      'Это не npm-проект (нет package.json), поэтому зависимостью инструмент не подключить.',
      'Зови его по пути из папки самого инструмента:',
      '',
      `       node ${toolDir}/dist/cli.js init ${project}`,
      `       node ${toolDir}/dist/cli.js case <id>`,
      '',
      'Ничего не устанавливается и никуда не копируется. Скилл кладётся только в этот проект,',
      'и в нём же будет записано, как звать инструмент.',
    );
  }

  lines.push(
    '',
    'Куда класть скилл, команда установки спросит сама: покажет каталоги .claude/skills,',
    '.agents/skills этого проекта.',
    'До ответа не создаётся ни один файл. Ответить заранее — `init --for claude`',
    '(через запятую можно несколько).',
  );

  return { project, isNpmProject, lines };
}
