/**
 * Commande /anime - Transformation d'image en style anime
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdAnime(senderId, args, ctx) {
    const { userLastImage, addToMemory, getRandomInt, log } = ctx;
    const senderIdStr = String(senderId);
    
    // Vérifier si l'utilisateur a envoyé une image récemment
    if (!userLastImage.has(senderIdStr)) {
        return `🎨 OH ! Je n'ai pas d'image à transformer en anime ! ✨

📸 Envoie-moi d'abord une image, puis tape /anime !
🎭 Ou utilise /image [description] anime style pour créer directement !

💡 ASTUCE : Envoie une photo → tape /anime → MAGIE ! 🪄💕`;
    }
    
    try {
        // Récupérer l'URL de la dernière image
        const lastImageUrl = userLastImage.get(senderIdStr);
        
        // Créer une version anime avec un prompt spécialisé
        const animePrompt = "anime style, beautiful detailed anime art, manga style, kawaii, colorful, high quality anime transformation";
        const encodedPrompt = encodeURIComponent(animePrompt);
        
        // Générer l'image anime avec un seed différent
        const seed = getRandomInt(100000, 999999);
        const animeImageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=768&seed=${seed}&enhance=true&nologo=true`;
        
        // Sauvegarder dans la mémoire
        addToMemory(senderIdStr, 'user', "Transformation anime demandée");
        addToMemory(senderIdStr, 'bot', "Image transformée en anime style");
        
        // Retourner l'image anime
        return {
            type: "image",
            url: animeImageUrl,
            caption: `🎭 Tadaaa ! Voici ta transformation anime avec tout mon amour ! ✨\n\n🎨 Style: Anime kawaii détaillé\n🔢 Seed magique: ${seed}\n\n💕 J'espère que tu adores le résultat ! Envoie une autre image et tape /anime pour recommencer ! 🌟`
        };
    } catch (error) {
        log.error(`❌ Erreur transformation anime: ${error.message}`);
        return `🎭 Oh non ! Une petite erreur dans mon atelier anime ! 😅

🔧 Mes pinceaux magiques ont un petit souci, réessaie !
📸 Ou envoie une nouvelle image et retente /anime !
❓ Tape /help si tu as besoin d'aide ! 💖`;
    }
};
