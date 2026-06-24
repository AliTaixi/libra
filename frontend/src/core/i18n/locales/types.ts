import type { LucideIcon } from "lucide-react";

export interface Translations {
  // Locale meta
  locale: {
    localName: string;
  };

  // Common
  common: {
    home: string;
    settings: string;
    delete: string;
    edit: string;
    rename: string;
    share: string;
    openInNewWindow: string;
    close: string;
    more: string;
    search: string;
    loadMore: string;
    download: string;
    notAvailableInDemoMode: string;
    upload: string;
    uploading: string;
    uploadingFiles: string;
    uploadFailed: string;
    uploadFileSizeExceeded: string;
    dragAndDrop: string;
    dropToAttach: string;
    total: string;
    input: string;
    output: string;
    tokens: string;
    rex: string;
    inProgress: string;
    completed: string;
    mode: string;
    flashMode: string;
    flashModeDescription: string;
    proMode: string;
    proModeDescription: string;
    ultraMode: string;
    ultraModeDescription: string;
    searchModels: string;
    surpriseMe: string;
    surpriseMePrompt: string;
    followupLoading: string;
    followupConfirmTitle: string;
    followupConfirmDescription: string;
    followupConfirmAppend: string;
    followupConfirmReplace: string;
    suggestions: {
      suggestion: string;
      prompt: string;
      icon: LucideIcon;
    }[];
    suggestionsCreate: (
      | {
          suggestion: string;
          prompt: string;
          icon: LucideIcon;
        }
      | {
          type: "separator";
        }
    )[];
  };

  // Sidebar
  sidebar: {
    recentChats: string;
    newChat: string;
    chats: string;
    demoChats: string;
    agents: string;
    writing: string;
    drawio: string;
    knowledgeBase: string;
  };

  // Writing
  writing: {
    title: string;
    description: string;
    newDraft: string;
    loading: string;
    emptyTitle: string;
    emptyDescription: string;
    newButton: string;
    deleteConfirm: string;
    deleteSuccess: string;
    deleteFailed: string;
    untitled: string;
    chapters: string;
    updatedAt: string;
    selectModel: string;
    stages: { start: string; writing: string; complete: string };
    docTypes: { report: string; proposal: string; thesis: string; manual: string; spec: string };
    chooseMode: string;
    fromScratch: string;
    fromScratchDesc: string;
    fromScratchHint: string;
    uploadTemplate: string;
    uploadTemplateDesc: string;
    uploadTemplateHint: string;
    back: string;
    step1Name: string;
    step1Placeholder: string;
    step2DocType: string;
    step2Placeholder: string;
    step3Description: string;
    step3Placeholder: string;
    linkKnowledgeBase: string;
    linkKnowledgeBaseHint: string;
    noKnowledgeBase: string;
    generateOutline: string;
    generatingOutline: string;
    editL1Title: string;
    editL1Hint: string;
    editL2Title: string;
    editL2Hint: string;
    editL3Title: string;
    editL3Hint: string;
    stepLabel: string;
    headingLabel: (level: number) => string;
    subheading: string;
    add: string;
    aiGenerate: string;
    insertBelow: string;
    delete: string;
    unnamed: string;
    noSubheadings: string;
    createDocument: string;
    creatingDocument: string;
    startWriting: string;
    fillProjectNameFirst: string;
    outlineGenEmptyError: string;
    outlineGenFailed: (msg: string) => string;
    l1GenSuccess: (count: number) => string;
    l2GenEmptyError: string;
    l2GenFailed: (msg: string) => string;
    l2GenSuccess: (count: number) => string;
    l3GenEmptyError: string;
    l3GenFailed: (msg: string) => string;
    l3GenSuccess: (count: number) => string;
    keepOneChapter: string;
    createFailed: string;
    uploaded: string;
    generatingL2: string;
    generatingL3: string;
    parseTemplateFailed: string;
    l1Generate: string;
    l2Generate: string;
    l3Generate: string;
    regenerateL1: string;
    regenerateL2: string;
    regenerateL3: string;
    uploadTemplateTitle: string;
    wordTemplate: string;
    wordTemplateDesc: string;
    uploadFile: string;
    objectDescription: string;
    objectDescriptionDesc: string;
    formatRequirements: string;
    formatRequirementsHint: string;
    optional: string;
    required: string;
    uploadSuccess: string;
    uploadFailed: string;
    uploadFormatFile: string;
    or: string;
    formatPlaceholder: string;
    parseTemplate: string;
    parsingTemplate: string;
    templateRequired: string;
    save: string;
    saveSuccess: string;
    saveFailed: string;
    nextStage: string;
    chapter: string;
    chapterOf: string;
    modify: string;
    modifyPlaceholder: string;
    wordCountMin: string;
    wordCountMax: string;
    modifyBtn: string;
    modifying: string;
    generateChart: string;
    generateDiagram: string;
    generateTable: string;
    generating: string;
    aiGeneratingContent: string;
    contentEmpty: string;
    contentEmptyHint: string;
    retry: string;
    retrying: string;
    noChapters: string;
    completeStage: string;
    backToEdit: string;
    totalWords: string;
    words: string;
    chapterList: string;
    documentPreview: string;
    notWritten: string;
    continueEditing: string;
    exportWord: string;
    exporting: string;
    exportFailed: string;
    exportSuccess: string;
    generatingLabel: string;
    retrySuccess: string;
    retryFailed: string;
  };

  // Drawio
  drawio: {
    title: string;
    description: string;
    newDiagram: string;
    aiAssistant: string;
    aiPlaceholder: string;
    aiGenerate: string;
    aiGenerating: string;
    aiApply: string;
    aiApplying: string;
    aiReject: string;
    aiNoModel: string;
    aiSelectModel: string;
    emptyStateTitle: string;
    emptyStateDescription: string;
    emptyStateAction: string;
    saveSuccess: string;
    exportSuccess: string;
    exportImage: string;
    exportXml: string;
    toolbarExport: string;
    toolbarPanelOpen: string;
    toolbarPanelClose: string;
    applySuccess: string;
    applyFailed: string;
    exportFailed: string;
    exportHint: string;
    clearChat: string;
    /** 工具栏 - 未保存提示 */
    unsaved: string;
    /** 前置页 - 从零开始标题 */
    fromScratchTitle: string;
    /** 前置页 - 从零开始描述 */
    fromScratchDesc: string;
    /** 前置页 - 从零开始输入框占位 */
    fromScratchPlaceholder: string;
    /** 前置页 - 生成按钮 */
    fromScratchGenerate: string;
    /** 前置页 - 选择文件标题 */
    selectFileTitle: string;
    /** 前置页 - 选择文件描述 */
    selectFileDesc: string;
    /** 前置页 - 文件列表为空 */
    selectFileEmpty: string;
    /** 前置页 - 加载中 */
    preflowLoading: string;
    /** 前置页 - 重试 */
    preflowRetry: string;
  };

  // Knowledge Base
  knowledgeBase: {
    title: string;
    description: string;
    newCollection: string;
    loading: string;
    emptyTitle: string;
    emptyDescription: string;
    createButton: string;
    collectionCount: string;
    documentCount: string;
    newPageTitle: string;
    newPageDescription: string;
    nameLabel: string;
    nameRequired: string;
    namePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    createAndUpload: string;
    cancel: string;
    createSuccess: string;
    createFailed: string;
    collectionNotFound: string;
    backToHome: string;
    uploadTitle: string;
    uploadTo: string;
    documentTitle: string;
    documentTitlePlaceholder: string;
    fileUpload: string;
    pasteContent: string;
    markdownContent: string;
    markdownPlaceholder: string;
    dragDropHint: string;
    supportedFormats: string;
    selectFile: string;
    reselect: string;
    uploadAndIndex: string;
    uploading: string;
    uploadSuccess: string;
    titleRequired: string;
    contentRequired: string;
    uploadFailed: string;
    docCount: string;
    noDocuments: string;
    noDocumentsHint: string;
    uploadDoc: string;
    tableTitle: string;
    tableType: string;
    tableStatus: string;
    tableCreatedAt: string;
    noDescription: string;
  };

  // Agents
  agents: {
    title: string;
    description: string;
    newAgent: string;
    emptyTitle: string;
    emptyDescription: string;
    chat: string;
    delete: string;
    deleteConfirm: string;
    deleteSuccess: string;
    newChat: string;
    createPageTitle: string;
    createPageSubtitle: string;
    nameStepTitle: string;
    nameStepHint: string;
    nameStepPlaceholder: string;
    nameStepContinue: string;
    nameStepInvalidError: string;
    nameStepAlreadyExistsError: string;
    nameStepNetworkError: string;
    nameStepCheckError: string;
    nameStepApiDisabledError: string;
    nameStepBootstrapMessage: string;
    save: string;
    saving: string;
    saveRequested: string;
    saveHint: string;
    saveCommandMessage: string;
    agentCreatedPendingRefresh: string;
    more: string;
    agentCreated: string;
    startChatting: string;
    backToGallery: string;
  };

  // Breadcrumb
  breadcrumb: {
    workspace: string;
    chats: string;
  };

  // Workspace
  workspace: {
    officialWebsite: string;
    githubTooltip: string;
    settingsAndMore: string;
    visitGithub: string;
    reportIssue: string;
    contactUs: string;
    about: string;
    logout: string;
  };

  // Conversation
  conversation: {
    noMessages: string;
    startConversation: string;
  };

  // Chats
  chats: {
    searchChats: string;
  };

  // Page titles (document title)
  pages: {
    appName: string;
    chats: string;
    newChat: string;
    untitled: string;
  };

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => string;
    lessSteps: string;
    executeCommand: string;
    presentFiles: string;
    needYourHelp: string;
    useTool: (toolName: string) => string;
    searchForRelatedInfo: string;
    searchForRelatedImages: string;
    searchFor: (query: string) => string;
    searchForRelatedImagesFor: (query: string) => string;
    searchOnWebFor: (query: string) => string;
    viewWebPage: string;
    listFolder: string;
    readFile: string;
    writeFile: string;
    clickToViewContent: string;
    writeTodos: string;
    skillInstallTooltip: string;
  };

  // Uploads
  uploads: {
    uploading: string;
    uploadingFiles: string;
    selectFromFiles: string;
    noFiles: string;
    searchFiles: string;
  };

  // Subtasks
  subtasks: {
    subtask: string;
    executing: (count: number) => string;
    in_progress: string;
    completed: string;
    failed: string;
  };

  // Token Usage
  tokenUsage: {
    title: string;
    label: string;
    input: string;
    output: string;
    total: string;
    view: string;
    unavailable: string;
    unavailableShort: string;
    note: string;
    presets: {
      off: string;
      summary: string;
      perTurn: string;
      debug: string;
    };
    presetDescriptions: {
      off: string;
      summary: string;
      perTurn: string;
      debug: string;
    };
    finalAnswer: string;
    stepTotal: string;
    sharedAttribution: string;
    subagent: (description: string) => string;
    startTodo: (content: string) => string;
    completeTodo: (content: string) => string;
    updateTodo: (content: string) => string;
    removeTodo: (content: string) => string;
  };

  // Shortcuts
  shortcuts: {
    searchActions: string;
    noResults: string;
    actions: string;
    keyboardShortcuts: string;
    keyboardShortcutsDescription: string;
    openCommandPalette: string;
    toggleSidebar: string;
  };

  // Settings
  settings: {
    title: string;
    description: string;
    sections: {
      account: string;
      appearance: string;
      files: string;
      models: string;
      skills: string;
      notification: string;
      about: string;
    };
    files: {
      title: string;
      description: string;
      loading: string;
      loadFailed: string;
      empty: string;
      all: string;
      deleteConfirm: string;
      deleteSuccess: string;
      deleteFailed: string;
    };
    appearance: {
      themeTitle: string;
      themeDescription: string;
      system: string;
      light: string;
      dark: string;
      systemDescription: string;
      lightDescription: string;
      darkDescription: string;
      languageTitle: string;
      languageDescription: string;
    };
    models: {
      title: string;
      description: string;
      addButton: string;
      editButton: string;
      deleteButton: string;
      deleteConfirm: string;
      formName: string;
      formNamePlaceholder: string;
      formModel: string;
      formModelPlaceholder: string;
      formDisplayName: string;
      formDisplayNamePlaceholder: string;
      formUse: string;
      formApiKey: string;
      formApiKeyPlaceholder: string;
      formBaseUrl: string;
      formBaseUrlPlaceholder: string;
      formVision: string;
      empty: string;
      addSuccess: string;
      updateSuccess: string;
      deleteSuccess: string;
    };
    skills: {
      title: string;
      description: string;
      createSkill: string;
      emptyTitle: string;
      emptyDescription: string;
      emptyButton: string;
    };
    notification: {
      title: string;
      description: string;
      requestPermission: string;
      deniedHint: string;
      testButton: string;
      testTitle: string;
      testBody: string;
      notSupported: string;
      disableNotification: string;
    };
    account: {
      profileTitle: string;
      email: string;
      role: string;
      userManagement: string;
      userManagementDescription: string;
      changePasswordTitle: string;
      changePasswordDescription: string;
      currentPassword: string;
      newPassword: string;
      confirmNewPassword: string;
      passwordMismatch: string;
      passwordTooShort: string;
      passwordChangedSuccess: string;
      networkError: string;
      updating: string;
      updatePassword: string;
      signOut: string;
    };
    acknowledge: {
      emptyTitle: string;
      emptyDescription: string;
    };
  };
}
