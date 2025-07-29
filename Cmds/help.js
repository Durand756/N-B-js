/**
 * Commande /help - Affichage de l'aide
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdHelp(senderId, args, ctx) {
    const { isAdmin } = ctx;
    
    const commands = {
        "/start": "🤖 Ma présentation toute mignonne",
        "/music": "🎵 Recherche et partage un lien YouTube vers la musique souhaitée, même si le titre est mal écrit",
        "/image [description]": "🎨 Je crée des images magnifiques avec l'IA !",
        "/anime": "🎭 Je transforme ta dernière image en style anime !",
        "/vision": "👁️ Je décris ce que je vois sur ta dernière image !",
        "/chat [message]": "💬 On papote de tout avec gentillesse",
        "/help": "❓ Cette aide pleine d'amour"
    };
    
    let text = "🤖 NAKAMABOT v4.0 AMICALE + VISION - GUIDE COMPLET 💖\n\n";
    text += "✨ Voici tout ce que je peux faire pour toi :\n\n";
    
    for (const [cmd, desc] of Object.entries(commands)) {
        text += `${cmd} - ${desc}\n\n`;
    }
    
    if (isAdmin(senderId)) {
        text += "\n🔐 COMMANDES ADMIN SPÉCIALES :\n";
        text += "/stats - Mes statistiques (admin seulement)\n";
        text += "/admin - Mon panneau admin\n";
        text += "/broadcast [msg] - Diffusion avec amour\n";
        text += "/restart - Me redémarrer en douceur\n";
    }
    
    text += "\n🎨 JE PEUX CRÉER DES IMAGES ! Utilise /image [ta description] !";
    text += "\n🎭 JE TRANSFORME EN ANIME ! Envoie une image puis /anime !";
    text += "\n👁️ J'ANALYSE TES IMAGES ! Envoie une image puis /vision !";
    text += "\n👨‍💻 Créée avec tout l'amour du monde par Durand 💕";
    text += "\n✨ Je suis là pour t'aider avec le sourire !";
    text += "\n💖 N'hésite jamais à me demander quoi que ce soit !";
    
    return text;
};
