import type { OfficialExtensionsDict } from './index'

export const fr: OfficialExtensionsDict = {
  reviewsName: 'Revues',
  reviewsDescription:
    'Envoyez des plans et des modèles en revue, décidez fichier par fichier et suivez les commentaires jusqu’à une décision.',
  reviewsAddsView: 'la vue Revues',
  reviewsAddsMenu: 'le sous-menu Revues du menu contextuel',
  reviewsAddsPane: 'le panneau de revue',
  reviewsAddsStages: 'les étapes de revue des workflows de fichiers',
  reviewsEffectRelease: 'Les plans sont publiés sans revue approuvée.',
  reviewsEffectStages: 'Les étapes de revue des workflows de fichiers se comportent comme des états ordinaires.',
  inspectionName: 'Inspection',
  inspectionDescription:
    'Ajoutez des bulles aux plans, conservez les tableaux d’inspection par version et remplissez des rapports Excel.',
  inspectionAddsTab: 'l’onglet Inspection des plans',
  inspectionAddsReports: 'les rapports d’inspection sous les plans',
  inspectionAddsTemplates: 'Paramètres > Modèles d’inspection',
  inspectionEffectWorkingCopies:
    'Les rapports d’un plan extrait restent sur l’ancienne version jusqu’à la réinstallation d’Inspection.',
  ordersName: 'Commandes',
  ordersDescription: 'Regroupez des sorties PDF, STEP et autres liées à une version en commandes pour les fournisseurs.',
  ordersAddsView: 'la vue Commandes',
  ordersAddsMenu: 'le sous-menu Commandes du menu contextuel',
  ordersAddsHistory: '« Ajouter à la commande » dans l’historique des versions',

  core_explorer: 'Explorateur de fichiers',
  core_versions: 'Versions',
  core_workflows: 'Workflows de fichiers',
  core_solidworks: 'SOLIDWORKS',

  sectionTitle: 'Extensions BluePLM',
  sectionIntro:
    'Des fonctions intégrées à BluePLM. Les installer ou les désinstaller les change pour toute votre organisation.',
  sectionIntroMember: 'Seul un administrateur peut les installer ou les désinstaller.',
  statusInstalled: 'Installée',
  statusNotInstalled: 'Non installée',
  version: 'Version {{version}}',
  adds: 'Ajoute',
  needs: 'Nécessite',
  neededBy: 'Nécessaire à',
  worksWith: 'Fonctionne avec',
  none: 'Rien',
  install: 'Installer',
  uninstall: 'Désinstaller',
  listSeparator: ', ',

  uninstallTitle: 'Désinstaller {{name}} ?',
  uninstallBody: '{{name}} disparaît pour tout le monde dans {{org}} : {{surfaces}}.',
  uninstallKeeps:
    'Rien n’est supprimé. Ses données restent dans votre base et vos sauvegardes, et la réinstaller ramène tout.',
  uninstallBlocked: '{{names}} nécessite {{name}}. Désinstallez-la d’abord.',
  integrationsDark: 'Ne fonctionne plus avec {{names}}.',
  installTitle: 'Installer {{name}} ?',
  installBody: '{{name}} revient pour tout le monde dans {{org}} : {{surfaces}}.',
  installAlso: 'Installe aussi {{names}}, nécessaire à {{name}}.',
  integrationsLight: 'Fonctionne avec {{names}}.',
  yourOrganization: 'votre organisation',

  installed: '{{name}} est installée pour votre organisation.',
  uninstalled: '{{name}} est désinstallée. Vous pouvez la réinstaller ici à tout moment.',
  failed: '{{name}} n’a pas pu être modifiée : {{message}}',
  notInstalled:
    '{{name}} n’est pas installée pour votre organisation. Un administrateur peut l’installer dans Paramètres > Extensions.',
  error_NOT_ADMIN: 'Seul un administrateur peut installer ou désinstaller des extensions.',
  error_UNKNOWN_EXTENSION: 'BluePLM ne connaît pas cette extension. Mettez à jour l’application ou la base de données.',
  error_DEPENDENCY_INSTALLED: 'Une autre extension installée en a besoin.',
  error_DEPENDENCY_MISSING: 'Une extension nécessaire n’est pas installée.',
  error_NEEDS_UPGRADE:
    'La base de données est plus ancienne que cette application. Mettez-la d’abord à jour dans Paramètres > Connexion.',
}
