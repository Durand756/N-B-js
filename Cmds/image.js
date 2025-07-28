/**
 * Commande /image - Génération d'images IA
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Description de l'image à générer
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdImage(senderId, args, ctx) {
    const { addToMemory, getRandomInt, log } = ctx;
    
    if (!args.trim()) {
        return `🎨 OH OUI ! Je peux générer des images magnifiques ! ✨

🖼️ /image [ta description] - Je crée ton image de rêve !
🎨 /image chat robot mignon - Exemple adorable
🌸 /image paysage féerique coucher soleil - Exemple poétique
⚡ /image random - Une surprise image !

💕 Je suis super douée pour créer des images ! Décris-moi ton rêve et je le dessine pour toi !
🎭 Tous les styles : réaliste, cartoon, anime, artistique...

💡 Plus tu me donnes de détails, plus ton image sera parfaite !
❓ Besoin d'aide ? Tape /help pour voir toutes mes capacités ! 🌟`;
    }
    
    let prompt = args.trim();
    const senderIdStr = String(senderId);
    
    // Images aléatoires si demandé
    if (prompt.toLowerCase() === "random") {
        const randomPrompts = [
            "beautiful fairy garden with sparkling flowers and butterflies",
            "cute magical unicorn in enchanted forest with rainbow",
            "adorable robot princess with jeweled crown in castle",
            "dreamy space goddess floating among stars and galaxies",
            "magical mermaid palace underwater with pearl decorations",
            "sweet vintage tea party with pastel colors and roses",
            "cozy cottagecore house with flower gardens and sunshine",
            "elegant anime girl with flowing dress in cherry blossoms"
        ];
        prompt = randomPrompts[Math.floor(Math.random() * randomPrompts.length)];
    }
    
    // Valider le prompt
    if (prompt.length < 3) {
        return "❌ Oh là là ! Ta description est un peu courte ! Donne-moi au moins 3 lettres pour que je puisse créer quelque chose de beau ! 💕";
    }
    
    if (prompt.length > 200) {
        return "❌ Oups ! Ta description est trop longue ! Maximum 200 caractères s'il te plaît ! 🌸";
    }
    
    try {
        // Encoder le prompt pour l'URL
        const encodedPrompt = encodeURIComponent(prompt);
        
        // Générer l'image avec l'API Pollinations
        const seed = getRandomInt(100000, 999999);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=768&seed=${seed}&enhance=true&nologo=true`;
        
        // Sauvegarder dans la mémoire
        addToMemory(senderIdStr, 'user', `Image demandée: ${prompt}`);
        addToMemory(senderIdStr, 'bot', `Image générée: ${prompt}`);
        
        // Retourner l'image avec caption
        return {
            type: "image",
            url: imageUrl,
            caption: `🎨 Tadaaa ! Voici ton image créée avec amour ! ✨\n\n📝 "${prompt}"\n🔢 Seed magique: ${seed}\n\n💕 J'espère qu'elle te plaît ! Tape /image pour une nouvelle création ou /help pour voir tout ce que je sais faire ! 🌟`
        };
    } catch (error) {
        log.error(`❌ Erreur génération image: ${error.message}`);
        return `🎨 Oh non ! Une petite erreur temporaire dans mon atelier artistique ! 😅

🔧 Mon pinceau magique est un peu fatigué, réessaie dans quelques secondes !
🎲 Ou essaie /image random pour une surprise !
❓ Tape /help si tu as besoin d'aide ! 💖`;
    }
};
