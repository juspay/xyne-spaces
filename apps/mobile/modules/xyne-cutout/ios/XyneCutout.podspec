Pod::Spec.new do |s|
  s.name           = 'XyneCutout'
  s.version        = '1.0.0'
  s.summary        = 'Xyne Cutout: rounded holes cut out of a view, for avatar stacks and badges.'
  s.description    = 'Xyne Cutout: rounded holes cut out of a view, for avatar stacks and badges.'
  s.license        = 'UNLICENSED'
  s.author         = 'Xyne'
  s.homepage       = 'https://xyne.io'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
