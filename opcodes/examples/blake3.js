//
// Memory management 
//
let ENV = {}

let S = i => `state_${i}`
let M = i => `msg_${i}`

for (let i = 0; i < 16; i++) {
    ENV[S(i)] = i
    ENV[M(i)] = i + 16 + 256 / 4 // The offset is the length of the message + the u32 size of our XOR table
}

const ptr_extract = identifier => {
    if (!(identifier in ENV))
        throw `Undefined variable ${identifier}`

    const index = ENV[identifier]
    delete ENV[identifier]
    Object.keys(ENV).forEach(key => {
        if (index < ENV[key])
            ENV[key] -= 1
    })
    return index
}

const ptr_insert = identifier => {
    Object.keys(ENV).forEach(key => ENV[key] += 1)
    ENV[identifier] = 0
}


//
// Blake3
//

// The length of the message is always 64 bytes in this implementation
const BLOCK_LEN = 64

// The initial state
const IV = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19]
const INITIAL_STATE = [IV[0], IV[1], IV[2], IV[3], IV[4], IV[5], IV[6], IV[7], IV[0], IV[1], IV[2], IV[3], 0, 0, BLOCK_LEN, 0b00001011]

// The permutations
const MSG_PERMUTATION = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8]

// 
// The Blake3 "quarter round"
// As described in the paper in "2.2 Compression Function"
// https://github.com/BLAKE3-team/BLAKE3-specs/blob/master/blake3.pdf
//
const G = (_ap, a, b, c, d, m0, m1) => [
    // Stack:  m1 m0 d c b a  |

    // z = a+b+m0 
    u32_copy_zip(ENV[b], ptr_extract(a)),
    u32_add,
    u32_copy_zip(ENV[m0] + 1, 0),
    u32_add,
    // Stack:  m1 m0 d c b  |  z

    // y = (d^z) >>> 16
    u32_copy_zip(0, ptr_extract(d) + 1),
    u32_xor(_ap + 1),
    u32_rrot16,
    // Stack:  m1 m0 c b  |  z y


    // x = y+c
    u32_copy_zip(0, ptr_extract(c) + 2),
    u32_add,
    // Stack:  m1 m0 b  |  z y x

    // w = (b^x) >>> 12
    u32_copy_zip(0, ptr_extract(b) + 3),
    u32_xor(_ap + 1),
    u32_rrot12,
    // Stack:  m1 m0 |  z y x w


    // v = z+w+m1
    u32_copy_zip(0, 3),
    u32_add,
    u32_copy_zip(ENV[m1] + 4, 0),
    u32_add,
    // Stack: m1 m0 |  y x w v

    // u = (y^v) >>> 8
    u32_copy_zip(0, 3),
    u32_xor(_ap + 1),
    u32_rrot8,
    // Stack: m1 m0 |  x w v u

    // t = x+u
    u32_copy_zip(0, 3),
    u32_add,
    // Stack: m1 m0 |  w v u t

    // s = (w^t) >>> 7
    u32_copy_zip(0, 3),
    u32_xor(_ap + 1),
    u32_rrot7,
    // Stack: m1 m0 |  v u t s


    ptr_insert(a),
    ptr_insert(d),
    ptr_insert(c),
    ptr_insert(b),
]

//
// A "round" of Blake3
//
const round = _ap => [
    G(_ap, S(0), S(4), S(8),  S(12), M(0),  M(1)),
    G(_ap, S(1), S(5), S(9),  S(13), M(2),  M(3)),
    G(_ap, S(2), S(6), S(10), S(14), M(4),  M(5)),
    G(_ap, S(3), S(7), S(11), S(15), M(6),  M(7)),

    G(_ap, S(0), S(5), S(10), S(15), M(8),  M(9)),
    G(_ap, S(1), S(6), S(11), S(12), M(10), M(11)),
    G(_ap, S(2), S(7), S(8),  S(13), M(12), M(13)),
    G(_ap, S(3), S(4), S(9),  S(14), M(14), M(15)),
]

//
// The "permute" function of Blake3
//
const permute = _ => {
    const prevState = {}
    for (let i = 0; i < 16; i++) {
        prevState[M(i)] = ENV[M(i)]  
    }

    Object.keys(prevState).forEach( (identifier, i) => {
        const prevIdentifier = M( MSG_PERMUTATION[i] )
        ENV[identifier] = prevState[prevIdentifier]
    })
}

//
// The "compress" function of Blake3
//
const compress = _ap => [
    // Perform 7 rounds and permute after each round, 
    // except for the last round
    loop(6, _ => [
        round(_ap), 
        permute(),
    ]),
    round(_ap),

    // XOR states [0..7] with states [8..15]
    loop(8, i => [
        u32_copy_zip(ENV[S(i)] + i, ptr_extract(S(8+i)) + i), 
        u32_xor(_ap + 1)
    ])
];

//
// Blake3 on a 64-byte input
//
const blake3 = _ => [
    // Initialize our lookup table
    // We have to do that only once per program
    u32_push_xor_table,


    // Push the initial Blake state onto the stack
    INITIAL_STATE.reduce((a, e) => u32_push(e) + a, ''),

    // Perform a round of Blake3    
    compress(16),

    //
    // Clean up the stack
    //
    loop(32, _ => u32_toaltstack),
    u32_drop_xor_table,
    loop(32, _ => u32_fromaltstack),

    loop(24, i => u32_roll( i + 8 ) ),
    loop(24, _ => u32_drop ),
];


const u256_equalverify = loop(8, i => [
    u32_zip(0, 8 - i),
    u32_equalverify,
]);




//
// Putting everything together...
//
[

`
//
// Input: A 64-byte message in the unlocking script
//
`,
bytesFromText('Bitcoin: A Peer-to-Peer Electronic Cash System -Satoshi Nakamoto'),

`

//--------------------------------------------------------


//
// Program: A Blake3 hash lock
//

`,

// Sanitize the 64-byte message 
sanitizeBytes(64),

// Compute Blake3
blake3(),

// Uncomment the following line to inspect the resulting hash
'debug;',

// Push the expected hash onto the stack
bytesFromHex('9db86b5fddd9ecb030c3906be402f95235b33f7b7bc0bee243e5b545d2de5648'),

// Verify the result of Blake3 is the expected hash
u256_equalverify,

// Finally, push OP_TRUE onto the stack
1

]