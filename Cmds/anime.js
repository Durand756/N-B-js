/**
 * Commande /anime - VRAIE transformation d'image en style anime
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
        // Récupérer l'URL de la dernière image de l'utilisateur
        const originalImageUrl = userLastImage.get(senderIdStr);
        
        // Créer un prompt de transformation anime détaillé
        const transformPrompt = "transform this image into beautiful anime art style, anime character, manga style, detailed anime drawing, vibrant colors, anime aesthetic, high quality anime transformation, keep the main subject and composition but make it anime style";
        
        // Encoder le prompt pour l'URL
        const encodedPrompt = encodeURIComponent(transformPrompt);
        
        // Encoder l'image originale pour l'inclure dans la requête
        const encodedImageUrl = encodeURIComponent(originalImageUrl);
        
        // Générer la transformation anime en utilisant l'image originale comme base
        const seed = getRandomInt(100000, 999999);
        
        // URL pour transformation d'image avec Pollinations
        // Cette approche utilise l'image originale comme référence pour la transformation
        const animeTransformUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=768&seed=${seed}&enhance=true&nologo=true&model=flux&image=${encodedImageUrl}`;
        
        // Alternative avec une approche différente si la première ne fonctionne pas bien
        const alternativeUrl = `https://image.pollinations.ai/prompt/anime%20style%20transformation%20of%20this%20image,%20beautiful%20anime%20art,%20manga%20style,%20detailed%20anime%20character?width=768&height=768&seed=${seed}&enhance=true&nologo=true&reference=${encodedImageUrl}`;
        
        // Sauvegarder dans la mémoire
        addToMemory(senderIdStr, 'user', "Transformation anime de l'image demandée");
        addToMemory(senderIdStr, 'bot', `Image transformée en style anime (seed: ${seed})`);
        
        // Log pour debug
        log.info(`🎨 Transformation anime - Original: ${originalImageUrl}`);
        log.info(`🎭 URL de transformation: ${animeTransformUrl}`);
        
        // Retourner l'image transformée
        return {
            type: "image",
            url: animeTransformUrl,
            caption: `🎭 Tadaaa ! Voici ta photo transformée en anime ! ✨\n\n🖼️ Image originale → Style anime kawaii\n🎨 Transformation magique appliquée !\n🔢 Seed: ${seed}\n\n💕 Ta photo est maintenant un personnage d'anime ! Si le résultat ne te plaît pas, renvoie /anime pour une autre version ! 🌈✨`
        };
        
    } catch (error) {
        log.error(`❌ Erreur transformation anime: ${error.message}`);
        return `🎭 Oh non ! Une petite erreur dans mon atelier anime ! 😅
🔧 Mes pinceaux magiques ont un petit souci, réessaie !
📸 Assure-toi que ton image est bien accessible !
❓ Tape /help si tu as besoin d'aide ! 💖`;
    }
};
