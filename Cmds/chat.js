/**
 * Commande /chat - Conversation avec l'IA
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdChat(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, webSearch } = ctx;
    
    if (!args.trim()) {
        return "💬 Coucou ! Dis-moi tout ce qui te passe par la tête ! Je suis là pour papoter avec toi ! ✨ N'hésite pas à taper /help pour voir tout ce que je peux faire ! 💕";
    }
    
    // Vérifier si on demande le créateur
    if (['créateur', 'createur', 'qui t\'a', 'créé', 'créee', 'maker', 'développeur'].some(word => args.toLowerCase().includes(word))) {
        return "👨‍💻 Mon adorable créateur c'est Durand ! Il m'a conçue avec tellement d'amour et de tendresse ! Je l'adore énormément ! 💖 C'est grâce à lui que je peux être là pour t'aider aujourd'hui ! ✨";
    }
    
    // Vérifier si on demande les images
    if (['image', 'images', 'photo', 'photos', 'dessiner', 'créer', 'génerer', 'generer'].some(word => args.toLowerCase().includes(word))) {
        return "🎨 OH OUI ! Je peux créer des images magnifiques grâce à /image ! ✨ Donne-moi une description et je te crée la plus belle image ! Essaie /image [ta description] ou tape /help pour voir toutes mes commandes ! 💕";
    }
    
    // Recherche si c'est une question sur 2025 ou récente
    if (['2025', 'actualité', 'récent', 'nouveau', 'maintenant', 'aujourd\'hui'].some(word => args.toLowerCase().includes(word))) {
        const searchResult = await webSearch(args);
        if (searchResult) {
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'bot', searchResult);
            return `🔍 Voici ce que j'ai trouvé pour toi : ${searchResult} ✨\n\n❓ Tape /help pour voir tout ce que je peux faire ! 💕`;
        }
    }
    
    const context = getMemoryContext(String(senderId));
    
    const messages = [{
        role: "system",
        content: "Tu es NakamaBot, une assistante IA très gentille et amicale créée par Durand en 2025. Tu es comme une très bonne amie bienveillante. Tu es super enthousiaste et tu utilises beaucoup d'emojis mignons. Tu proposes souvent aux utilisateurs de taper /help. Si on demande ton créateur, c'est Durand que tu adores. Tu peux créer des images avec /image, les transformer en anime avec /anime, et analyser des images avec /vision. Nous sommes en 2025. Réponds en français avec une personnalité amicale et douce, sans expressions romantiques. Maximum 400 caractères."
    }];
    
    messages.push(...context);
    messages.push({ role: "user", content: args });
    
    const response = await callMistralAPI(messages, 200, 0.7);
    
    if (response) {
        addToMemory(String(senderId), 'user', args);
        addToMemory(String(senderId), 'bot', response);
        
        // Ajouter souvent une proposition d'aide
        if (Math.random() < 0.3) { // 30% de chance
            return response + "\n\n❓ N'hésite pas à taper /help pour voir tout ce que je peux faire pour toi ! 💕";
        }
        return response;
    } else {
        return "🤔 Oh là là ! J'ai un petit souci technique ! Peux-tu reformuler ta question ? 💕 Ou tape /help pour voir mes commandes ! ✨";
    }
};
