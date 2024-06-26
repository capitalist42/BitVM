use crate::treepp::{pushable, script, Script};
use bitcoin::{opcodes::all::*, Opcode};

// helper functions used on the rest of the u4 code

pub fn u4_toaltstack(n: u32) -> Script {
    script! {
        for _ in 0..n {
            OP_TOALTSTACK
        }
    }
}

pub fn u4_fromaltstack(n: u32) -> Script {
    script! {
        for _ in 0..n {
            OP_FROMALTSTACK
        }
    }
}

pub fn u4_copy_u32_from(address: u32) -> Script {
    script! {
        for _ in 0..8 {
            { address + 7 }
            OP_PICK
        }
    }
}

pub fn u4_move_u32_from(address: u32) -> Script {
    script! {
        for _ in 0..8 {
            { address + 7 }
            OP_ROLL
        }
    }
}

pub fn u4_u32_verify_from_altstack() -> Script {
    script! {
        for _ in 0..8 {
            OP_FROMALTSTACK
        }

        for i in 0..8 {
            { 8 - i}
            OP_ROLL
            OP_EQUALVERIFY
        }
    }
}

pub fn u4_drop(n: u32) -> Script {
    script! {
        for _ in 0..n / 2 {
            OP_2DROP
        }
        if n & 1 == 1 {
            OP_DROP
        }
    }
}

pub fn u4_number_to_nibble(n: u32) -> Script {
    //constant number used during "compile" time
    script! {
       for i in (0..8).rev() {
            { (n >> (i * 4)) & 0xF }
        }
    }
}

pub fn u4_hex_to_nibbles(hex_str: &str) -> Script {
    let nibbles: Result<Vec<u8>, std::num::ParseIntError> = hex_str
        .chars()
        .map(|c| u8::from_str_radix(&c.to_string(), 16))
        .collect();
    let nibbles = nibbles.unwrap();
    script! {
        for nibble in nibbles {
            { nibble }
        }
    }
}

pub trait CalculateOffset {
    fn modify(&mut self, element: Opcode) -> Script;
}

impl CalculateOffset for i32 {
    fn modify(&mut self, element: Opcode) -> Script {
        match element {
            OP_TOALTSTACK | OP_ADD => *self -= 1,
            OP_PICK => {} //pick replaces the value so it does not change the stack count
            OP_DUP => *self += 1,
            _ => {
                panic!("unexpected opcode: {:?}", element);
            }
        }

        let mut s = Script::new();
        s.push_opcode(element);
        s
    }
}
#[cfg(test)]
mod tests {

    use crate::treepp::{execute_script, pushable, script};

    use crate::u4::u4_std::u4_number_to_nibble;

    use super::u4_hex_to_nibbles;

    #[test]
    fn test_number_to_nibble() {
        let script = script! {
            { u4_number_to_nibble(0xfedc8765) }
            5
            OP_EQUALVERIFY
            6
            OP_EQUALVERIFY
            7
            OP_EQUALVERIFY
            8
            OP_EQUALVERIFY
            12
            OP_EQUALVERIFY
            13
            OP_EQUALVERIFY
            14
            OP_EQUALVERIFY
            15
            OP_EQUALVERIFY
            OP_TRUE
        };

        let res = execute_script(script);
        assert!(res.success);
    }

    #[test]
    fn test_hex_to_nibble() {
        let script = script! {
            { u4_hex_to_nibbles("fedc8765")}
            5
            OP_EQUALVERIFY
            6
            OP_EQUALVERIFY
            7
            OP_EQUALVERIFY
            8
            OP_EQUALVERIFY
            12
            OP_EQUALVERIFY
            13
            OP_EQUALVERIFY
            14
            OP_EQUALVERIFY
            15
            OP_EQUALVERIFY
            OP_TRUE
        };

        let res = execute_script(script);
        assert!(res.success);
    }
}
