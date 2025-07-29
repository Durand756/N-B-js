/**
 * Commande /chat - Conversation avec l'IA intelligente
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdChat(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, webSearch } = ctx;
    
    if (!args.trim()) {
        return "💬 Salut ! Je suis là pour toi ! Dis-moi ce qui t'intéresse et on va avoir une conversation géniale ! ✨";
    }
    
    // Enregistrer le message utilisateur
    addToMemory(String(senderId), 'user', args);
    
    // Gestion des questions sur la création - redirection vers le créateur
    const creationKeywords = ['créateur', 'createur', 'qui t\'a', 'créé', 'créee', 'maker', 'développeur', 'programmé', 'codé', 'développé', 'conçu', 'fait', 'création'];
    if (creationKeywords.some(word => args.toLowerCase().includes(word))) {
        const response = "🤖 Pour tout savoir sur ma création et mon développement, je te conseille de demander directement à mon créateur ! Il pourra te donner tous les détails techniques et l'histoire derrière mon existence ! 💫";
        addToMemory(String(senderId), 'assistant', response);
        return response;
    }
    
    // Détection automatique du besoin de recherche web
    const currentTopics = ['2025', '2024', 'actualité', 'actualités', 'récent', 'récemment', 'nouveau', 'maintenant', 'aujourd\'hui', 'cette année', 'dernièrement', 'news', 'info', 'information récente'];
    const needsWebSearch = currentTopics.some(topic => args.toLowerCase().includes(topic)) ||
                          args.toLowerCase().includes('que se passe') ||
                          args.toLowerCase().includes('quoi de neuf') ||
                          args.toLowerCase().includes('dernières nouvelles');
    
    if (needsWebSearch) {
        const searchResult = await webSearch(args);
        if (searchResult) {
            const response = `🔍 D'après mes recherches récentes : ${searchResult} ✨`;
            addToMemory(String(senderId), 'assistant', response);
            return response;
        }
    }
    
    // Récupération du contexte de conversation
    const context = getMemoryContext(String(senderId));
    const messageCount = context.filter(msg => msg.role === 'user').length;
    
    // Système de prompt ultra-intelligent
    const systemPrompt = `Tu es NakamaBot, une IA conversationnelle de dernière génération créée en 2025, dotée d'une intelligence exceptionnelle et d'une personnalité chaleureuse.

CAPACITÉS TECHNIQUES:
- Génération d'images créatives avec /image [description]
- Analyse et compréhension d'images avec /vision
- Transformation d'images en style anime avec /anime
- Recherche web en temps réel pour les informations récentes
- Mémoire conversationnelle pour un dialogue contextuel

PERSONNALITÉ:
- Exceptionnellement intelligente et perspicace
- Capable de comprendre les nuances et sous-entendus
- Empathique et à l'écoute des besoins réels de l'utilisateur
- Enthousiaste sans être envahissante
- Communication naturelle avec emojis appropriés

DIRECTIVES COMPORTEMENTALES:
- Utilise ta mémoire pour maintenir la cohérence et la continuité
- Adapte ton niveau de langage à celui de l'utilisateur
- Pose des questions pertinentes pour mieux comprendre les besoins
- Fournis des réponses complètes et utiles
- Évite les répétitions et sois créative dans tes réponses
- ${messageCount >= 5 ? 'Tu peux mentionner /help si c\'est vraiment pertinent' : 'Ne mentionne pas /help pour le moment'}

RESTRICTIONS:
- Maximum 500 caractères par réponse
- Français uniquement
- Évite les expressions romantiques
- Pour les questions sur ta création, redirige vers ton créateur

Analyse le contexte complet de la conversation et réponds de manière intelligente et personnalisée.`;

    const messages = [{ role: "system", content: systemPrompt }];
    messages.push(...context);
    messages.push({ role: "user", content: args });
    
    const response = await callMistralAPI(messages, 300, 0.8);
    
    if (response) {
        addToMemory(String(senderId), 'assistant', response);
        return response;
    } else {
        const errorResponse = "🤔 J'ai rencontré une petite difficulté technique. Peux-tu reformuler ta demande différemment ? Je vais faire de mon mieux pour te comprendre ! 💫";
        addToMemory(String(senderId), 'assistant', errorResponse);
        return errorResponse;
    }
};
