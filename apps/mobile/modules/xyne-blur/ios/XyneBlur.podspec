Pod::Spec.new do |s|
  s.name           = 'XyneBlur'
  s.version        = '1.0.0'
  s.summary        = 'Xyne Blur: frosted surfaces for the header and bottom bar.'
  s.description    = 'Xyne Blur: frosted surfaces for the header and bottom bar.'
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
