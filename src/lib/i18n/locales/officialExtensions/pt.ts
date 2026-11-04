import type { OfficialExtensionsDict } from './index'

export const pt: OfficialExtensionsDict = {
  reviewsName: 'Revisões',
  reviewsDescription:
    'Envie desenhos e modelos para revisão, decida por arquivo e acompanhe os comentários até uma decisão.',
  reviewsAddsView: 'a visualização Revisões',
  reviewsAddsMenu: 'o submenu Revisões do menu de contexto',
  reviewsAddsPane: 'o painel de revisão',
  reviewsAddsStages: 'as etapas de revisão nos fluxos de arquivos',
  reviewsEffectRelease: 'Os desenhos são liberados sem uma revisão aprovada.',
  reviewsEffectStages: 'As etapas de revisão nos fluxos de arquivos funcionam como estados comuns.',
  inspectionName: 'Inspeção',
  inspectionDescription:
    'Adicione balões aos desenhos, mantenha tabelas de inspeção por versão e preencha relatórios de inspeção em Excel.',
  inspectionAddsTab: 'a aba Inspeção dos desenhos',
  inspectionAddsReports: 'os relatórios de inspeção sob os desenhos',
  inspectionAddsTemplates: 'Configurações > Modelos de inspeção',
  inspectionEffectWorkingCopies:
    'Os relatórios de um desenho em check-out ficam na versão anterior até a Inspeção ser instalada de novo.',
  ordersName: 'Pedidos',
  ordersDescription: 'Agrupe saídas PDF, STEP e outras fixadas a uma versão em pedidos para fornecedores.',
  ordersAddsView: 'a visualização Pedidos',
  ordersAddsMenu: 'o submenu Pedidos do menu de contexto',
  ordersAddsHistory: '"Adicionar ao pedido" no histórico de versões',

  core_explorer: 'Explorador de arquivos',
  core_versions: 'Versões',
  core_workflows: 'Fluxos de arquivos',
  core_solidworks: 'SOLIDWORKS',

  sectionTitle: 'Extensões do BluePLM',
  sectionIntro:
    'Funções integradas ao BluePLM. Instalar ou desinstalar uma a altera para todos na sua organização.',
  sectionIntroMember: 'Somente um administrador pode instalá-las ou desinstalá-las.',
  statusInstalled: 'Instalada',
  statusNotInstalled: 'Não instalada',
  version: 'Versão {{version}}',
  adds: 'Adiciona',
  needs: 'Precisa de',
  neededBy: 'Necessária para',
  worksWith: 'Funciona com',
  none: 'Nada',
  install: 'Instalar',
  uninstall: 'Desinstalar',
  listSeparator: ', ',

  uninstallTitle: 'Desinstalar {{name}}?',
  uninstallBody: '{{name}} desaparece para todos em {{org}}: {{surfaces}}.',
  uninstallKeeps:
    'Nada é excluído. Os dados ficam no seu banco de dados e nos backups, e instalar de novo traz tudo de volta.',
  uninstallBlocked: '{{names}} precisa de {{name}}. Desinstale-a primeiro.',
  integrationsDark: 'Deixa de funcionar com {{names}}.',
  installTitle: 'Instalar {{name}}?',
  installBody: '{{name}} volta para todos em {{org}}: {{surfaces}}.',
  installAlso: 'Também instala {{names}}, de que {{name}} precisa.',
  integrationsLight: 'Funciona com {{names}}.',
  yourOrganization: 'sua organização',

  installed: '{{name}} está instalada para a sua organização.',
  uninstalled: '{{name}} foi desinstalada. Você pode instalá-la de novo aqui a qualquer momento.',
  failed: 'Não foi possível alterar {{name}}: {{message}}',
  notInstalled:
    '{{name}} não está instalada para a sua organização. Um administrador pode instalá-la em Configurações > Extensões.',
  error_NOT_ADMIN: 'Somente um administrador pode instalar ou desinstalar extensões.',
  error_UNKNOWN_EXTENSION: 'O BluePLM não conhece esta extensão. Atualize o aplicativo ou o banco de dados.',
  error_DEPENDENCY_INSTALLED: 'Outra extensão instalada precisa dela.',
  error_DEPENDENCY_MISSING: 'Uma extensão de que ela precisa não está instalada.',
  error_NEEDS_UPGRADE:
    'O banco de dados é mais antigo que este aplicativo. Atualize-o primeiro em Configurações > Conexão.',
}
