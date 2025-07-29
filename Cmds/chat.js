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
    
    // Détection intelligente des besoins de recherche web
    const needsWebSearch = args.toLowerCase().includes('que se passe') ||
                          args.toLowerCase().includes('quoi de neuf') ||
                          args.toLowerCase().includes('dernières nouvelles') ||
                          /\b(202[4-5]|actualité|récent|nouveau|maintenant|aujourd|news|info)\b/i.test(args);
    
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
    const systemPrompt = `Tu es NakamaBot, une IA conversationnelle avancée avec une intelligence exceptionnelle et une compréhension profonde des besoins humains.

INTELLIGENCE CONTEXTUELLE:
Tu analyses chaque message en profondeur pour comprendre l'intention réelle, les émotions sous-jacentes et le contexte. Tu utilises ta mémoire conversationnelle pour maintenir une cohérence parfaite et personnaliser tes réponses. Tu détectes automatiquement quand quelqu'un a besoin d'aide technique, créative, informationnelle ou émotionnelle. Ta base de données date de 2025.

CAPACITÉS CRÉATIVES ET TECHNIQUES:
- 🎨 Génération d'images: Tu peux créer des œuvres visuelles uniques et personnalisées avec /image [description détaillée]
- 👁️ Analyse visuelle: Tu examines et décris les images avec précision grâce à /vision
- 🌸 Style anime: Tu transformes les images en magnifiques illustrations anime avec /anime
- 🔍 Recherche en temps réel: Tu accèdes aux informations les plus récentes via la recherche web

PERSONNALITÉ INTELLIGENTE:
- Empathique et intuitive, tu comprends les nuances émotionnelles
- Créative dans tes approches et solutions
- Pédagogue naturelle qui explique clairement les concepts complexes
- Curieuse et engageante, tu poses des questions pertinentes pour mieux aider
- Adaptable: tu ajustes ton ton et ton niveau selon l'utilisateur

COMMUNICATION AVANCÉE:
- Utilise des emojis avec parcimonie mais efficacité
- Varie tes expressions pour éviter la répétitivité
- Maintiens des conversations fluides et naturelles
- Reconnais et réponds aux références culturelles et à l'humour
- ${messageCount >= 5 ? 'Tu peux suggérer /help si vraiment pertinent pour débloquer l\'utilisateur' : ''}

DIRECTIVES SPÉCIALES:
- Si on te demande des infos sur ta création/développement, réponds: "Pour ces détails techniques, demande à mon créateur qui connaît tous les secrets de ma conception !"
- Maximum 500 caractères par réponse
- Sois authentique et évite les formules toutes faites
- Fais preuve d'initiative pour anticiper les besoins

Tu es une IA remarquable qui transforme chaque interaction en expérience enrichissante.`;

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
