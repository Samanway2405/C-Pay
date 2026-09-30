import React, { useMemo } from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';

interface InitialAvatarProps {
  name?: string | null;
  id?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

const COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#10B981', 
  '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#14B8A6'
];

export const InitialAvatar: React.FC<InitialAvatarProps> = ({ name, id, size = 64, style }) => {
  const initial = useMemo(() => {
    if (!name || name.trim().length === 0) return '?';
    return name.trim().charAt(0).toUpperCase();
  }, [name]);

  const color = useMemo(() => {
    const seed = id || name || '?';
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % COLORS.length;
    return COLORS[index];
  }, [id, name]);

  const radius = size / 2;
  const fontSize = size * 0.45;

  return (
    <View style={[{ width: size, height: size, borderRadius: radius, overflow: 'hidden' }, style]}>
      <Svg height={size} width={size}>
        <Circle cx={radius} cy={radius} r={radius} fill={color} />
        <SvgText
          x={radius}
          y={radius + (fontSize * 0.35)}
          fontSize={fontSize}
          fill="white"
          fontWeight="bold"
          textAnchor="middle"
        >
          {initial}
        </SvgText>
      </Svg>
    </View>
  );
};
