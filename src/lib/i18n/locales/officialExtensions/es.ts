import type { OfficialExtensionsDict } from './index'

export const es: OfficialExtensionsDict = {
  reviewsName: 'Revisiones',
  reviewsDescription:
    'Envíe planos y modelos a revisión, decida por archivo y siga los comentarios hasta una decisión.',
  reviewsAddsView: 'los paquetes de revisión de la vista Revisiones',
  reviewsAddsMenu: 'el submenú Revisiones del menú contextual',
  reviewsAddsPane: 'el panel de revisión',
  reviewsAddsStages: 'las etapas de revisión en los flujos de archivos',
  reviewsEffectRelease: 'Los planos se liberan sin una revisión aprobada.',
  reviewsEffectStages: 'Las etapas de revisión de los flujos de archivos funcionan como estados normales.',
  reviewsEffectGates: 'La vista Revisiones conserva solo las aprobaciones de flujos.',
  inspectionName: 'Inspección',
  inspectionDescription:
    'Añada globos a los planos, guarde tablas de inspección por versión y rellene informes de inspección en Excel.',
  inspectionAddsTab: 'la pestaña Inspección de los planos',
  inspectionAddsReports: 'los informes de inspección bajo los planos',
  inspectionAddsTemplates: 'Configuración > Plantillas de inspección',
  inspectionEffectWorkingCopies:
    'Los informes de un plano extraído se quedan en la versión anterior hasta que Inspección se instale de nuevo.',
  supplyChainName: 'Cadena de suministro',
  supplyChainDescription:
    'Proveedores, el portal de proveedores y pedidos de salidas PDF, STEP y otras fijadas a una versión para ellos.',
  supplyChainAddsView: 'la vista Pedidos',
  supplyChainAddsMenu: 'el submenú Pedidos del menú contextual',
  supplyChainAddsHistory: '«Añadir al pedido» en el historial de versiones',
  supplyChainAddsSettings: 'Configuración > Pedidos',
  supplyChainAddsSuppliers: 'la base de datos de proveedores',
  supplyChainAddsPortal: 'el portal de proveedores',
  supplyChainAddsVendors: 'la pestaña Proveedores de los archivos',

  core_explorer: 'Explorador de archivos',
  core_versions: 'Versiones',
  core_workflows: 'Flujos de archivos',
  core_solidworks: 'SOLIDWORKS',

  sectionTitle: 'Extensiones de BluePLM',
  sectionIntro:
    'Funciones integradas en BluePLM. Instalar o desinstalar una la cambia para todos en su organización.',
  sectionIntroMember: 'Solo un administrador puede instalarlas o desinstalarlas.',
  statusInstalled: 'Instalada',
  statusNotInstalled: 'No instalada',
  version: 'Versión {{version}}',
  adds: 'Añade',
  needs: 'Necesita',
  neededBy: 'La necesita',
  worksWith: 'Funciona con',
  none: 'Nada',
  install: 'Instalar',
  uninstall: 'Desinstalar',
  listSeparator: ', ',

  uninstallTitle: '¿Desinstalar {{name}}?',
  uninstallBody: '{{name}} desaparece para todos en {{org}}: {{surfaces}}.',
  uninstallKeeps:
    'No se borra nada. Sus datos se quedan en la base de datos y en las copias de seguridad, y al instalarla de nuevo vuelve todo.',
  uninstallBlocked: '{{names}} necesita {{name}}. Desinstálela primero.',
  integrationsDark: 'Deja de funcionar con {{names}}.',
  installTitle: '¿Instalar {{name}}?',
  installBody: '{{name}} vuelve para todos en {{org}}: {{surfaces}}.',
  installAlso: 'También instala {{names}}, que {{name}} necesita.',
  integrationsLight: 'Funciona con {{names}}.',
  yourOrganization: 'su organización',

  installed: '{{name}} está instalada para su organización.',
  uninstalled: '{{name}} está desinstalada. Puede instalarla de nuevo aquí en cualquier momento.',
  failed: 'No se pudo cambiar {{name}}: {{message}}',
  notInstalled:
    '{{name}} no está instalada para su organización. Un administrador puede instalarla en Configuración > Extensiones.',
  error_NOT_ADMIN: 'Solo un administrador puede instalar o desinstalar extensiones.',
  error_UNKNOWN_EXTENSION: 'BluePLM no conoce esta extensión. Actualice la aplicación o la base de datos.',
  error_DEPENDENCY_INSTALLED: 'Otra extensión instalada la necesita.',
  error_DEPENDENCY_MISSING: 'Una extensión que necesita no está instalada.',
  error_NEEDS_UPGRADE:
    'La base de datos es más antigua que esta aplicación. Actualícela primero en Configuración > Conexión.',
}
