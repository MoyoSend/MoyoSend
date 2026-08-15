import { useState } from "react";
import { View, TextInput, TouchableOpacity, Text, StyleSheet, type TextInputProps, type ViewStyle, type StyleProp } from "react-native";

interface Props extends TextInputProps {
  containerStyle?: StyleProp<ViewStyle>;
}

export default function PasswordInput({ containerStyle, style, ...rest }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={[styles.wrapper, containerStyle]}>
      <TextInput {...rest} style={[styles.input, style]} secureTextEntry={!visible} />
      <TouchableOpacity onPress={() => setVisible((v) => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.toggleText}>{visible ? "Hide" : "Show"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e1d6",
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 16 },
  toggleText: { color: "#0e9488", fontWeight: "600", fontSize: 13, paddingLeft: 8 },
});