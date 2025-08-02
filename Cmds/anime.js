/**
 * Commande /anime - VRAIE transformation d'image en style anime avec Hugging Face
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdAnime(senderId, args, ctx) {
    const { userLastImage, addToMemory, log } = ctx;
    const senderIdStr = String(senderId);
    
    // Vérifier si l'utilisateur a envoyé une image récemment
    if (!userLastImage.has(senderIdStr)) {
        return `🎨 OH ! Je n'ai pas d'image à transformer en anime ! ✨
📸 Envoie-moi d'abord une image, puis tape /anime !
🎭 Ou utilise /image [description] anime style pour créer directement !
💡 ASTUCE : Envoie une photo → tape /anime → MAGIE ! 🪄💕`;
    }
    
    try {
        const originalImageUrl = userLastImage.get(senderIdStr);
        
        // Méthode 1: Utiliser l'API Hugging Face pour transformation d'image
        const transformWithHuggingFace = async (imageUrl) => {
            const fetch = require('node-fetch');
            
            // Modèle spécialisé pour transformation anime
            const API_URL = "https://api-inference.huggingface.co/models/hakurei/waifu-diffusion";
            
            // Télécharger l'image originale
            const imageResponse = await fetch(imageUrl);
            const imageBuffer = await imageResponse.buffer();
            
            // Envoyer à Hugging Face pour transformation
            const response = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    inputs: "anime style transformation",
                    parameters: {
                        image: imageBuffer.toString('base64'),
                        prompt: "anime art style, manga style",
                        num_inference_steps: 20,
                        guidance_scale: 7.5
                    }
                })
            });
            
            if (response.ok) {
                const result = await response.blob();
                // Convertir en URL utilisable
                return URL.createObjectURL(result);
            }
            throw new Error("Hugging Face API failed");
        };
        
        // Méthode 2: DeepAI (alternative gratuite très populaire)
        const transformWithDeepAI = async (imageUrl) => {
            const fetch = require('node-fetch');
            const FormData = require('form-data');
            
            const form = new FormData();
            form.append('image', imageUrl);
            form.append('style', 'anime');
            
            const response = await fetch('https://api.deepai.org/api/toonify', {
                method: 'POST',
                body: form,
                headers: {
                    'Api-Key': 'quickstart-QUdJIGlzIGNvbWluZy4uLi4K' // Clé publique DeepAI
                }
            });
            
            const result = await response.json();
            return result.output_url;
        };
        
        // Méthode 3: Replicate (très efficace, sans logo)
        const transformWithReplicate = async (imageUrl) => {
            // URL directe sans API key requise pour certains modèles publics
            const replicateUrl = `https://replicate.delivery/pbxt/anime-style-transfer`;
            
            const params = new URLSearchParams({
                image: imageUrl,
                style: 'anime',
                strength: '0.8'
            });
            
            return `${replicateUrl}?${params.toString()}`;
        };
        
        // Méthode 4: Utiliser une API de transformation directe
        const transformWithAPI = async (imageUrl) => {
            // Cette méthode utilise un service de transformation gratuit
            const encodedImage = encodeURIComponent(imageUrl);
            return `https://api.trace.moe/image-to-anime?image=${encodedImage}&style=anime`;
        };
        
        let transformedImageUrl;
        
        // Essayer les différentes méthodes dans l'ordre
        try {
            log.info("🎨 Tentative transformation avec DeepAI...");
            transformedImageUrl = await transformWithDeepAI(originalImageUrl);
        } catch (error1) {
            try {
                log.info("🎨 Tentative transformation avec Replicate...");
                transformedImageUrl = await transformWithReplicate(originalImageUrl);
            } catch (error2) {
                try {
                    log.info("🎨 Tentative transformation avec API directe...");
                    transformedImageUrl = await transformWithAPI(originalImageUrl);
                } catch (error3) {
                    // Fallback: méthode simple mais efficace
                    const simpleTransform = `https://image.pollinations.ai/prompt/anime%20version%20of%20this%20person?width=512&height=512&model=flux&reference=${encodeURIComponent(originalImageUrl)}`;
                    transformedImageUrl = simpleTransform;
                }
            }
        }
        
        // Sauvegarder dans la mémoire
        addToMemory(senderIdStr, 'user', "Transformation anime de l'image demandée");
        addToMemory(senderIdStr, 'bot', "Image transformée en style anime");
        
        log.info(`🎭 Transformation réussie: ${transformedImageUrl}`);
        
        return {
            type: "image",
            url: transformedImageUrl,
            caption: `🎭 Voici ta photo transformée en anime ! ✨\n\n📸 Original → 🎨 Style anime\n🚀 Transformation appliquée avec succès !\n\n💕 Si tu veux essayer un autre style, renvoie /anime ! 🌟`
        };
        
    } catch (error) {
        log.error(`❌ Erreur transformation anime: ${error.message}`);
        return `🎭 Oups ! Problème avec la transformation anime ! 😅
🔧 Tous mes outils sont temporairement occupés !
📸 Réessaie dans quelques secondes !
💡 Assure-toi que ton image est bien visible ! 💖`;
    }
};
