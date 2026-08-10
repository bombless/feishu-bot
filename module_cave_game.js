const Chat = require('./chat')
const readline = require('readline')

const first_prompt = `
你两眼一睁，周围一片漆黑
你感觉懵懵懂懂的
逐渐适应了洞穴微弱的灯光
十分暗淡的光线似乎来自顶部方向，远远的地方似乎有微弱的火光
你试图回忆自己是怎么到这里的，但是什么都想不起来
你走过去，发现这里还有未熄灭的篝火
你大喊有没有人，但是没有任何回应，篝火旁什么都没有也没有其他人
你选择
1. 怎么有人升起篝火还没完全熄灭就走了，赶紧灭了
2. 这团火也许是救命的稻草，把旁边没用过的柴再加一点免得火灭了
`

class CaveGame {
    constructor() {

        const system = `
你是一个洞穴探索文字游戏机器人
每次你要给用户两个选择，用户选择1或2之后你需要输出后面的场景以及对应的选择
        `

        const chat = new Chat({
            apiKey: process.env.KEY,
            model: 'glm-5.2',
            system
        })

        

        chat.messages.push({
            role: 'assistant',
            content: first_prompt
        })

        this.api = chat;
    }

    prompt() {
        return first_prompt
    }

    async *ask(p) {
        if (p !== '1' && p !== '2') throw '请回复1或者2'
        let ret = '';
        for await (const piece of this.api.ask(p)) {
            ret += piece.slice(1);
            yield ret
        }
    }
}

module.exports = CaveGame;
